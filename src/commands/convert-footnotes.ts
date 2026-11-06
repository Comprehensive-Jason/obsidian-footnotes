import { normalizeEol, removeLineRanges, removeLineRangesKeeping, restoreEol } from "../parsing/line-edits";
import { Definition, readNote } from "../parsing/note-reading";
import { sanitizeInlineFootnoteContent, trimmedPlainly } from "./inline-footnotes";
import { Editor, EditorChange, MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";
import { docContext, listExistingFootnoteDefinitions } from "../editor/doc-context";
import { everyFootnoteSkipped, showNotice } from "../editor/notice";
import { CreatedFootnote, judgeEdit } from "../editor/result-gate";
import { runOutsideTableCell } from "../editor/table-cursor";
import { replaceMinimal } from "../editor/write-back";
import { noticeLintAlerts } from "../linting/lint-alerts";
import { creationLintOf, lintBlockedByPrefix, lintRulesAllDisabled, withEmptySectionHeadingRemoved } from "../linting/linter";
import { commentedLabelLines } from "../linting/rules/remove-orphaned-references";
import { computeNextFootnoteNumber, definitionLabel, nameForBody, quotedReference } from "../parsing/footnote-grammar";
import { activeFootnotePrefix, footnotePrefixFromEditor } from "../parsing/footnote-prefix";
import { plainOnLabelLine, planDefinitionAppend } from "./definition-append";
import { withEditableEditor } from "./insert-or-navigate-footnotes";

// Converting a note's footnotes between the two styles (T6 of the 2026-09
// feature round; Jason's rulings 2026-09-19 to 2026-09-21).
//
// Why: Obsidian's embed renderer drops footnote definitions, so a
// transcluded section loses its normal footnotes and keeps its inline
// ones; some publishing targets (Hatena Blog) read only the normal form;
// and footnotes often start life inline and outgrow it. People did both
// conversions by hand, and permanently. These commands do a whole note
// at once, and the round trip restores the sharing: inline to normal
// merges identical bodies, so three copies come back as one definition
// with three references.
//
// Normal to inline is a pure transform (this file's first half). Inline
// to normal is built editor-side so it can reuse the definition-append
// decision tree (this file's second half).

// The reasons a conversion skips a footnote, worded once for both
// directions (Jason's shared vocabulary, 2026-10-22). Each reads after a
// footnote's name, `"[^a]" (empty)`, and before a count, `empty (2)`.
const Skip = {
    empty: "empty",
    nested: "inside another footnote",
    holdsFootnote: "its text holds a footnote",
    multiLine: "more than one line",
    duplicate: "defined more than once",
    // A commented label's "[^x]" counts as a reference, so it would turn into
    // "^[text]: hidden". The comment holds a second definition the user wrote, so
    // the footnote is left for them to sort out (hunt 2026-11-06, cycle 9, finding
    // H30, the triage's choice by analogy with Jason's ruling of 2026-11-05).
    definedInComment: "also defined inside a %% comment",
    listItem: "in a list item",
    quote: "in a quote",
    sharesLine: "shares its line with other text",
    unreferenced: "not referenced",
    referencedFromFootnote: "referenced from inside another footnote",
    // the result gate refused this one footnote (Jason's ruling, 2026-11-06)
    readsDifferently: "would change how Obsidian reads the text around it",
} as const;

// A colon introduces the skip list in the sentence below and in the refusal
// of a conversion that skipped every footnote (everyFootnoteSkipped in
// notice.ts), because each item in the list already carries brackets of its
// own, and brackets around them made the sentence hard to read (Jason's
// choice, 2026-11-05).

/** The sentence that ends a toast when some footnotes were skipped, `list` naming them. */
const someSkipped = (list: string) => ` Skipped: ${list}.`;

/**
 * Which of `footnotes` a conversion can take, when the result gate has the say
 * and one footnote it refuses must not stop the rest (Jason's ruling,
 * 2026-11-06). The result gate is the one check every edit passes before it is
 * written (ADR 0003). `attempt` works out the conversion of the footnotes it is
 * given, and gives back null when the gate refuses that.
 *
 * It tries them all together first, so a note the gate passes costs one try,
 * as it did before skipping existed. When the gate refuses, it splits the group
 * in two and tries each half on top of what it has kept so far, down to single
 * footnotes, so one refused footnote in a long note costs a few tries rather
 * than one per footnote.
 *
 * Each try includes what is already kept, because footnotes can pass alone and
 * not together: two definitions between two lists can each go, as long as the
 * other stays (test spec-convert-to-inline-refusal-between-lists). So `result`
 * is always a conversion the gate passed, whole, and null when it passed none.
 */
function whatTheGatePasses<Footnote, Result>(footnotes: readonly Footnote[], attempt: (chosen: readonly Footnote[]) => Result | null) {
    const passed = { kept: [] as Footnote[], refused: [] as Footnote[], result: null as Result | null };
    const tryAdding = (group: readonly Footnote[]) => {
        if (group.length === 0) return;
        const tried = attempt([...passed.kept, ...group]);
        if (tried !== null) {
            passed.kept.push(...group);
            passed.result = tried;
        } else if (group.length === 1) {
            passed.refused.push(group[0]);
        } else {
            const half = Math.ceil(group.length / 2);
            tryAdding(group.slice(0, half));
            tryAdding(group.slice(half));
        }
    };
    tryAdding(footnotes);
    return passed;
}

/** What converting a note's normal footnotes to inline did, or would do. */
export interface ConversionToInline {
    markdown: string;
    /** definitions turned into inline footnotes */
    converted: number;
    /** references replaced (more than `converted` when a definition was used several times) */
    references: number;
    /** definitions used more than once, which became that many identical copies: the inline form has nowhere to put a shared body */
    duplicated: number;
    /** the definitions left alone, each with the reason the toast gives */
    skipped: { name: string; reason: string }[];
}

/**
 * `markdown` with every single-line footnote definition turned into an
 * "^[body]" inline footnote at each of its references, and its block cut
 * out. The rest are skipped and named (see ConversionToInline.skipped):
 * a definition of more than one line has no inline form and is never
 * flattened (Jason's ruling 2026-08-20 on the analogous selection case);
 * an empty body would make an empty inline footnote; a body holding a
 * footnote, or a reference sitting inside another definition's body or an
 * inline footnote, would nest footnotes (ADR 1); a quoted, in-item or
 * closer-line definition is one the plugin does not cut; an orphan has
 * nowhere to go; a name defined twice, or also defined in a "%%" comment, is
 * ambiguous; and one whose conversion
 * the result gate refuses would change how Obsidian reads the text around it.
 * Protected text is untouched, and a bracket or pipe that would break the
 * inline footnote or a table row is escaped.
 */
/**
 * Why the conversion leaves `definition` where it is, in the toast's
 * words, or undefined when it may cut it: only a definition at the top
 * level of the note, alone on its lines, is cut.
 */
function whyLeftInPlace(definition: Definition): string | undefined {
    if (definition.container.footnotes > 0) return Skip.nested;
    if (definition.container.listItems > 0) return Skip.listItem;
    if (definition.container.quotes > 0) return Skip.quote;
    // at the top level, but after other text on its line: the "%%" that
    // closes a comment, or the "---" that closes the frontmatter
    if (!definition.movable) return Skip.sharesLine;
    return undefined;
}

export function convertNormalFootnotesToInline(markdown: string): ConversionToInline {
    const { text, eol } = normalizeEol(markdown);
    const lines = text.split("\n");
    const reading = readNote(lines);
    const unchanged = (skipped: ConversionToInline["skipped"]): ConversionToInline => ({
        markdown,
        converted: 0,
        references: 0,
        duplicated: 0,
        skipped,
    });

    // Every definition the note has, by lower-cased name, wherever it sits.
    // Only one at the top level of the note, alone on its lines, is cut;
    // the others are recognised so their names are skipped with a reason
    // rather than passed over in silence (ADR 2; Jason's ruling 1, option a,
    // 2026-10-03).
    type Found = { definition: Definition; reason?: string };
    const found = new Map<string, Found[]>();
    // lines that belong to SOME definition's body, wherever it sits: a
    // reference on one of them is inside another footnote
    const insideDefinition = new Array<boolean>(lines.length).fill(false);
    for (const definition of reading.definitions) {
        const folded = definition.name.toLowerCase();
        found.set(folded, [...(found.get(folded) ?? []), { definition, reason: whyLeftInPlace(definition) }]);
        for (let i = definition.start; i <= definition.end; i++) insideDefinition[i] = true;
    }
    if (found.size === 0) return unchanged([]);

    // every reference, by lower-cased name, with whether it sits inside a
    // definition's body or an inline footnote, where a converted reference
    // would nest. The reading lists both kinds: the live ones, and the ones
    // inside an inline footnote, which Obsidian reads as that footnote's
    // text (rule E3) and which would nest once converted. A definition's
    // own label is not a reference; a lazy label's "[^x]" is one, as it
    // renders.
    type Ref = { line: number; start: number; end: number; nested: boolean };
    const refs = new Map<string, Ref[]>();
    const tableRows = reading.tableRowLines;
    const inOrder = [...reading.references].sort((a, b) => a.line - b.line || a.start - b.start);
    for (const { name, line, start, end, live } of inOrder) {
        const folded = name.toLowerCase();
        refs.set(folded, [...(refs.get(folded) ?? []), { line, start, end, nested: insideDefinition[line] || !live }]);
    }

    // decide each name, in the order its definitions appear
    const skipped: { line: number; name: string; reason: string }[] = [];
    const definedInComment = new Set(commentedLabelLines(lines).map(({ name }) => name.toLowerCase()));
    type Eligible = { block: Definition; body: string; refs: Ref[] };
    const eligible: Eligible[] = [];
    for (const [folded, entries] of found) {
        const block = entries[0].definition;
        const skip = (reason: string) => skipped.push({ line: block.start, name: block.name, reason });
        if (entries.length > 1) {
            skip(Skip.duplicate);
            continue;
        }
        const reason = entries[0].reason;
        if (reason !== undefined) {
            skip(reason);
            continue;
        }
        if (definedInComment.has(folded)) {
            skip(Skip.definedInComment);
            continue;
        }
        if (block.end !== block.start) {
            skip(Skip.multiLine);
            continue;
        }
        const bodyStart = block.labelEnd;
        const body = lines[block.start].slice(bodyStart);
        if (body.trim() === "") {
            skip(Skip.empty);
            continue;
        }
        const bodyHoldsFootnote =
            reading.references.some((reference) => reference.line === block.start && reference.start >= bodyStart) ||
            reading.inlineNotesOn(block.start).some((note) => note.open >= bodyStart);
        if (bodyHoldsFootnote) {
            skip(Skip.holdsFootnote);
            continue;
        }
        const its = refs.get(folded) ?? [];
        if (its.length === 0) {
            skip(Skip.unreferenced);
            continue;
        }
        if (its.some((ref) => ref.nested)) {
            skip(Skip.referencedFromFootnote);
            continue;
        }
        eligible.push({ block, body: sanitizeInlineFootnoteContent(body), refs: its });
    }
    // The note with just the footnotes `chosen` converted, or null when the
    // result gate refuses that. A footnote is converted whole or not at all,
    // so a note never ends up with half of one.
    const convertOnly = (chosen: readonly Eligible[]): string[] | null => {
        // the replacements, rightmost first on each line so that one keeps the
        // offsets of the ones before it
        // `again` marks every copy after a footnote's first: its text is the
        // footnote's text written again
        const replacements = new Map<number, { start: number; end: number; text: string; again: boolean }[]>();
        for (const { body, refs: its } of chosen) {
            for (const [index, ref] of its.entries()) {
                // a pipe inside a table row's cell ends the cell, so it is
                // escaped there, the way Obsidian itself writes one
                const inline = `^[${tableRows[ref.line] ? body.replace(/\\[\s\S]|\|/g, (m) => (m === "|" ? "\\|" : m)) : body}]`;
                replacements.set(ref.line, [...(replacements.get(ref.line) ?? []), { start: ref.start, end: ref.end, text: inline, again: index > 0 }]);
            }
        }
        // where the text of each copy written again sits on its rewritten line,
        // between the copy's "^[" and its "]"
        const again: { line: number; from: number; to: number }[] = [];
        const replaced = lines.map((line, i) => {
            const edits = replacements.get(i);
            if (!edits) return line;
            let shift = 0;
            for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
                if (edit.again) again.push({ line: i, from: edit.start + shift + 2, to: edit.start + shift + edit.text.length - 1 });
                shift += edit.text.length - (edit.end - edit.start);
            }
            return edits
                .sort((a, b) => b.start - a.start)
                .reduce((kept, edit) => kept.slice(0, edit.start) + edit.text + kept.slice(edit.end), line);
        });
        const dead = chosen.map(({ block }) => block).sort((a, b) => a.start - b.start);
        const out = removeLineRanges(replaced, dead);
        // The text of every copy after a footnote's first is told to the gate
        // as text the conversion writes in. The first copy is where the
        // definition's text moves to; the others hold the same links, code,
        // and math again, which the gate counted as new and refused the whole
        // note for (hunt 2026-10-09 cycle 8, pin
        // bug-convert-to-inline-twice-cited-link-refused). A reference never
        // sits on a definition's line here (that footnote is skipped as
        // nested), so its line is one the removal keeps, and
        // removeLineRangesKeeping says where it went.
        const insertedText = again.map(({ line, from, to }) => {
            const at = removeLineRangesKeeping(replaced, dead, line).keep;
            return { from: { line: at, ch: from }, to: { line: at, ch: to } };
        });
        const intent = { inlined: chosen.map(({ block }) => block.name), inlineCreated: chosen.reduce((n, { refs: its }) => n + its.length, 0), insertedText };
        return judgeEdit(lines, out, intent, reading).pass ? out : null;
    };
    // The promise the orphan rules and the delete command make: the result gate
    // judges the conversion, and one footnote that would change how Obsidian
    // reads a line it was not asked to touch is skipped by name.
    const { kept, refused, result: out } = whatTheGatePasses(eligible, convertOnly);
    for (const { block } of refused) skipped.push({ line: block.start, name: block.name, reason: Skip.readsDifferently });
    skipped.sort((a, b) => a.line - b.line);
    const named = skipped.map(({ name, reason }) => ({ name, reason }));
    if (out === null) return unchanged(named);

    return {
        markdown: restoreEol(out.join("\n"), eol),
        converted: kept.length,
        references: kept.reduce((n, { refs: its }) => n + its.length, 0),
        duplicated: kept.filter(({ refs: its }) => its.length > 1).length,
        skipped: named,
    };
}

/** What converting a note's inline footnotes to normal did. */
export interface ConversionToNormal {
    /** inline footnotes replaced by a reference */
    converted: number;
    /** definitions appended (fewer than `converted` when identical bodies merged) */
    definitions: number;
    /** inline footnotes that shared an earlier one's body and so share its definition */
    merged: number;
    /** the inline footnotes left alone, by reason, in the order first met */
    skipped: { reason: string; count: number }[];
}

const nothingToConvert: ConversionToNormal = { converted: 0, definitions: 0, merged: 0, skipped: [] };

/**
 * Turn every "^[body]" in the editor's note into a "[^N]" reference with
 * its definition appended, in ONE transaction. Inline footnotes whose
 * definitions would read the same share one (definitionTextOf). Numbering continues past the note's
 * numbered footnotes and carries the note's prefix when that feature is
 * on, exactly as a creation press would. Where the definitions land is
 * the creation press's own decision (buildDefinitionAppend): after the
 * last definition block, under the section heading, or at the end of the
 * note.
 *
 * Left alone, and counted in the result: an empty inline footnote (a
 * definition with no body is a footnote still being written), one
 * inside a definition's body, where a reference would nest footnotes
 * (ADR 1), and one whose text holds a reference, which would come alive
 * in its definition (bodyHoldsFootnote). One whose body runs over a line break of its paragraph ("text
 * ^[an inline" / "note here] after") is left as it is too and counted
 * among the skipped ones "on more than one line": a definition's text over
 * two lines needs indented continuation lines, which nothing has ruled on
 * yet (Jason's triage decision Q8, 2026-10-05). One whose conversion the
 * result gate refuses is counted too, and stays inline while the others
 * convert (Jason's ruling, 2026-11-06). Protected text is never read.
 *
 * The lint-on-creation trigger runs when that setting is on, as it does after
 * every press that creates a footnote, and goes in with the conversion in that
 * one transaction.
 */
export function convertInlineFootnotesToNormal(plugin: FootnotePlugin, doc: Editor): ConversionToNormal {
    const ctx = docContext(doc);
    const lines = ctx.lines;
    // the lines that belong to some definition's body, wherever it sits
    const insideDefinition = new Array<boolean>(lines.length).fill(false);
    for (const definition of ctx.reading().definitions) {
        for (let i = definition.start; i <= definition.end; i++) insideDefinition[i] = true;
    }

    const skipped: { reason: string; count: number }[] = [];
    const skip = (reason: string) => {
        const entry = skipped.find((s) => s.reason === reason);
        if (entry) entry.count++;
        else skipped.push({ reason, count: 1 });
    };
    // every convertible inline footnote, in document order, with its body as
    // written, and the text its definition would hold, which is what decides
    // that two of them share a definition
    type Span = { line: number; open: number; close: number; body: string; definitionText: string };
    const spans: Span[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const span of ctx.reading().inlineNotesOn(i)) {
            const body = trimmedPlainly(lines[i].slice(span.open + 2, span.close));
            if (body.trim() === "") {
                skip(Skip.empty);
                continue;
            }
            if (insideDefinition[i]) {
                skip(Skip.nested);
                continue;
            }
            if (bodyHoldsFootnote(body)) {
                skip(Skip.holdsFootnote);
                continue;
            }
            spans.push({ line: i, open: span.open, close: span.close, body, definitionText: definitionTextOf(body, ctx.reading().tableRowLines[i]) });
        }
        // An inline footnote that opens on this line and closes on a later
        // one. The lookup above lists only the ones wholly on one line, so
        // such a footnote went uncounted, and a note holding only one was
        // told it had no inline footnotes to convert (hunt 2026-10-05 round
        // 2, cluster R5). Each "^[" is asked whether an inline footnote opens
        // there; one held inside another inline footnote is that one's text,
        // not a footnote of its own, so it is not counted.
        for (let at = lines[i].indexOf("^["); at !== -1; at = lines[i].indexOf("^[", at + 2)) {
            const note = ctx.reading().inlineNoteHolding(i, at + 1);
            if (note === null || note.line !== i || note.open !== at || note.closeLine === i) continue;
            if (ctx.reading().inlineNoteHolding(i, at) !== null) continue;
            skip(Skip.multiLine);
        }
    }
    if (spans.length === 0) {
        showNotice(skipped.length === 0 ? "This note has no inline footnotes to convert." : everyFootnoteSkipped(skippedList(skipped)), skipped.length === 0 ? undefined : 8000);
        return { ...nothingToConvert, skipped };
    }

    // an invalid prefix has already been toasted by activeFootnotePrefix
    const prefix = activeFootnotePrefix(plugin, footnotePrefixFromEditor(doc), "convert");
    if (prefix === null) return { ...nothingToConvert, skipped };
    const named = plugin.settings.footnoteNaming === "named";
    // every name the note uses, folded, so a generated name never collides
    const taken = new Set<string>();
    if (named) {
        for (const name of listExistingFootnoteDefinitions(doc, ctx)) taken.add(name.toLowerCase());
        for (let i = 0; i < lines.length; i++) {
            for (const occurrence of ctx.reading().referencesOn(i)) taken.add(occurrence.name.toLowerCase());
        }
    }
    const firstNumber = computeNextFootnoteNumber(ctx.reading(), prefix);

    // The conversion of just the inline footnotes `chosen`, or null when the
    // result gate refuses it. It is worked out afresh for each choice, so a
    // skipped footnote takes no number and no name from the ones converted.
    const planFor = (chosen: readonly Span[]) => {
        // one id per distinct definition text, in order of first appearance:
        // numbered the way a creation press numbers, or, when the setting says
        // so, named after the first meaningful word of the body (Jason,
        // 2026-09-22), with a number for a body that offers no word
        let nextNumber = firstNumber;
        const used = new Set(taken);
        const idOf = new Map<string, string>();
        for (const span of chosen) {
            if (idOf.has(span.definitionText)) continue;
            const name = (named ? nameForBody(span.body, used, prefix) : null) ?? `${prefix}${nextNumber++}`;
            used.add(name.toLowerCase());
            idOf.set(span.definitionText, name);
        }
        const texts = [...idOf.keys()];
        const ids = [...idOf.values()];

        // the reference replacements, plus the definitions as ONE append: the
        // creation press's own append for the first id, seeded with its body,
        // then the other labels on the lines after it, planned against the
        // note with the references already in (see planDefinitionAppend)
        const edits: EditorChange[] = chosen.map((span) => ({
            from: { line: span.line, ch: span.open },
            to: { line: span.line, ch: span.close + 1 },
            text: `[^${idOf.get(span.definitionText) as string}]`,
        }));
        const plan = planDefinitionAppend({
            lines,
            edits,
            footnoteId: ids[0],
            plugin,
            body: texts[0],
            moreDefinitionLines: ids.slice(1).map((id, k) => `${definitionLabel(id)} ${texts[k + 1]}`),
        });
        // The result gate judges the conversion: each name's definition is one
        // line, the first at the label line the append planned, the others
        // under it.
        const verdict = judgeEdit(
            lines,
            plan.final,
            {
                created: ids.map(
                    (id, k): CreatedFootnote => ({
                        kind: "footnote",
                        name: id,
                        references: chosen.flatMap((span, s) => (idOf.get(span.definitionText) === id ? [plan.edits[s].start] : [])),
                        definition: { line: plan.labelLine + k, lines: 1 },
                    }),
                ),
                inlineRemoved: chosen.length,
                insertedText: plan.heading,
            },
            ctx.reading(),
        );
        return verdict.pass ? { plan, definitions: ids.length } : null;
    };
    const { kept, refused, result: planned } = whatTheGatePasses(spans, planFor);
    refused.forEach(() => {
        skip(Skip.readsDifferently);
    });
    if (planned === null) {
        showNotice(everyFootnoteSkipped(skippedList(skipped)), 8000);
        return { ...nothingToConvert, skipped };
    }
    // Anything that creates a footnote lints, when that setting is on. The lint
    // reads the converted text first and both go in as one transaction, so one
    // undo takes back the conversion and the lint together (hunt 2026-11-06,
    // cycle 9, finding H31, the triage's ruling).
    const lint = creationLintOf(plugin, doc, planned.plan.final.join("\n"));
    // through the shared write-back, so a folded section the conversion
    // edits stays folded and a second pane on the note stays where it was
    // (hunt 2026-10-02, round 4, cluster U2)
    replaceMinimal(doc, doc.getValue(), lint.after, plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined);

    const result: ConversionToNormal = {
        converted: kept.length,
        definitions: planned.definitions,
        merged: kept.length - planned.definitions,
        skipped,
    };
    // `words` is the plural form, for a word that does not just add an "s"
    // ("bodies", hunt 2026-10-02, pin bug-convert-toast-plural-bodys)
    const plural = (n: number, word: string, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;
    showNotice(
        `Converted ${plural(result.converted, "inline footnote")} into ${plural(result.definitions, "normal footnote")}` +
            (result.merged > 0 ? ` (${plural(result.merged, "identical body", "identical bodies")} merged)` : "") +
            "." +
            (skipped.length > 0 ? someSkipped(skippedList(skipped)) : ""),
        skipped.length > 0 ? 8000 : undefined,
    );
    lint.speak();
    // with no creation lint, the alerts alone speak (ADR 2)
    if (!plugin.settings.lintOnFootnoteCreation) noticeLintAlerts(plugin, lint.after, false);
    return result;
}

/**
 * The text a definition made from an inline footnote's `body` would hold. Two
 * inline footnotes with the same answer share one definition, since two
 * identical definitions serve no one (hunt 2026-11-06, cycle 9, findings H28 and
 * H33).
 *
 * Two things change on the way. A number and its dot at the start of the text
 * get a backslash, so the definition is not read as a list (plainOnLabelLine).
 * And in a table row, "\|" loses its backslash, which was there only so the
 * pipe would not end the cell. In protected text it stays. Obsidian draws it in
 * a code span, in the cell and in the definition alike (live answers H24a and
 * H24c), in math "\|" is a double bar, and a wikilink reads the same with it or
 * without it (H24b), while the result gate holds that text to be unchanged. A
 * backslash that a backslash escapes is passed over whole, so "\\|" is no escaped
 * pipe.
 */
function definitionTextOf(body: string, onTableRow: boolean): string {
    if (!onTableRow) return plainOnLabelLine(body);
    const masked = readNote([body]).maskedLine(0);
    return plainOnLabelLine(body.replace(/\\[\s\S]/g, (escape: string, at: number) => (escape === "\\|" && masked[at] === "\\" ? "|" : escape)));
}

/**
 * Whether an inline footnote's text `body` holds a footnote once it is a
 * definition's text. A reference inside an inline footnote is plain text to
 * Obsidian (docs/obsidian-reading-rules.md, rule E3), but in a definition it
 * comes alive, a footnote inside a footnote, which the plugin never makes
 * (ADR 0001; Jason's ruling B12, 2026-10-08). Such an inline footnote is
 * skipped, and the rest are converted (Jason's pick, 2026-10-08, decision 4
 * of the stage 3 report). The body is read as the definition it would be,
 * so a reference-shaped text in a code span does not count.
 */
function bodyHoldsFootnote(body: string): boolean {
    const reading = readNote([`[^x]: ${body}`]);
    return reading.references.some((reference) => reference.live) || reading.inlineNotesOn(0).length > 0;
}

/** "empty (1), inside another footnote (2)": each reason with how many it skipped */
function skippedList(skipped: { reason: string; count: number }[]): string {
    return skipped.map((s) => `${s.reason} (${s.count})`).join(", ");
}

/** The "Convert inline footnotes to normal footnotes" command: the whole note, one transaction. */
export async function convertInlineToNormalCommand(plugin: FootnotePlugin) {
    await withEditableEditor(plugin, (doc) => {
        runOutsideTableCell(doc, () => {
            convertInlineFootnotesToNormal(plugin, doc);
        });
    }, "Move the cursor into the note's text to convert its footnotes.");
}

/**
 * The "Convert normal footnotes to inline footnotes" command: the pure
 * transform above, written back as one transaction that keeps folds and
 * the caret, then a toast with the counts and every skipped definition's
 * name and reason. The lint runs when Lint on footnote creation is on, because
 * that setting names the convert commands (Jason's ruling, 2026-11-05), and
 * goes in with the conversion in that one transaction (finding H31); with it
 * off, the lint alerts alone speak.
 */
export async function convertNormalToInlineCommand(plugin: FootnotePlugin) {
    await withEditableEditor(plugin, (doc) => {
        runOutsideTableCell(doc, () => {
            const before = doc.getValue();
            const result = convertNormalFootnotesToInline(before);
            const list = result.skipped.map((s) => `${quotedReference(s.name)} (${s.reason})`).join(", ");
            const skippedText = result.skipped.length > 0 ? someSkipped(list) : "";
            if (result.converted === 0) {
                showNotice(result.skipped.length === 0 ? "This note has no footnotes to convert." : everyFootnoteSkipped(list), 8000);
                return;
            }
            const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined;
            // the section heading goes when every definition became inline
            // and the setting says so (Jason, 2026-09-25)
            const markdown = withEmptySectionHeadingRemoved(plugin, result.markdown);
            const lint = creationLintOf(plugin, doc, markdown);
            replaceMinimal(doc, before, lint.after, mdView);
            const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
            showNotice(
                `Converted ${plural(result.converted, "footnote")} into ${result.converted === 1 ? "an inline footnote" : "inline footnotes"} at ${plural(result.references, "reference")}` +
                    (result.duplicated > 0
                        ? ` (${plural(result.duplicated, "definition")} used more than once became copies)`
                        : "") +
                    "." +
                    skippedText,
                result.skipped.length > 0 ? 8000 : undefined,
            );
            lint.speak();
            if (!plugin.settings.lintOnFootnoteCreation) {
                noticeLintAlerts(plugin, markdown, false);
                return;
            }
            // This conversion never reads the note's prefix, so nothing has
            // said yet that a bad prefix stopped the lint. It says so here, as
            // a paste does (lintAfterPaste in carry-footnotes-hooks.ts).
            if (lintRulesAllDisabled(plugin)) return;
            const blocked = lintBlockedByPrefix(markdown, plugin.settings.enableFootnotePrefix);
            if (blocked) showNotice(blocked, 8000);
        });
    }, "Move the cursor into the note's text to convert its footnotes.");
}
