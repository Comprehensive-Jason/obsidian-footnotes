import { normalizeEol, removeLineRanges, restoreEol } from "../parsing/line-edits";
import { Definition, readNote } from "../parsing/note-reading";
import { linesReadDifferently } from "../linting/rules/remove-orphaned-definitions";
import { readsDifferently } from "../linting/rules/remove-orphaned-references";
import { sanitizeInlineFootnoteContent } from "./inline-footnotes";
import { Editor, EditorChange, MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";
import { docContext, listExistingFootnoteDefinitions } from "../editor/doc-context";
import { showNotice } from "../editor/notice";
import { runOutsideTableCell } from "../editor/table-cursor";
import { replaceMinimal } from "../editor/write-back";
import { noticeLintAlerts } from "../linting/lint-alerts";
import { lintAfterFootnoteCreation, withEmptySectionHeadingRemoved } from "../linting/linter";
import { computeNextFootnoteNumber, definitionLabel, nameForBody, quotedReference } from "../parsing/footnote-grammar";
import { activeFootnotePrefix, footnotePrefixFromEditor } from "../parsing/footnote-prefix";
import { planDefinitionAppend } from "./definition-append";
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
    /** set when the whole conversion was refused because it would change how Obsidian reads a line it was not asked to touch; `markdown` is then the input */
    refused?: string;
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
 * nowhere to go; a name defined twice is ambiguous. Protected text is
 * untouched, and a bracket or pipe that would break the inline footnote or
 * a table row is escaped.
 */
/**
 * Why the conversion leaves `definition` where it is, in the toast's
 * words, or undefined when it may cut it: only a definition at the top
 * level of the note, alone on its lines, is cut.
 */
function whyLeftInPlace(definition: Definition): string | undefined {
    if (definition.container.footnotes > 0) return "inside another footnote";
    if (definition.container.listItems > 0) return "inside a list item";
    if (definition.container.quotes > 0) return "inside a blockquote";
    // at the top level, but after other text on its line: the "%%" that
    // closes a comment, or the "---" that closes the frontmatter
    if (!definition.movable) return "shares its line with other text";
    return undefined;
}

export function convertNormalFootnotesToInline(markdown: string): ConversionToInline {
    const { text, eol } = normalizeEol(markdown);
    const lines = text.split("\n");
    const reading = readNote(lines);
    const unchanged = (skipped: ConversionToInline["skipped"], refused?: string): ConversionToInline => ({
        markdown,
        converted: 0,
        references: 0,
        duplicated: 0,
        skipped,
        ...(refused ? { refused } : {}),
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
    const eligible: { block: Definition; body: string; refs: Ref[] }[] = [];
    for (const [folded, entries] of found) {
        const block = entries[0].definition;
        const skip = (reason: string) => skipped.push({ line: block.start, name: block.name, reason });
        if (entries.length > 1) {
            skip("defined more than once");
            continue;
        }
        const reason = entries[0].reason;
        if (reason !== undefined) {
            skip(reason);
            continue;
        }
        if (block.end !== block.start) {
            skip("more than one line");
            continue;
        }
        const bodyStart = block.labelEnd;
        const body = lines[block.start].slice(bodyStart);
        if (body.trim() === "") {
            skip("empty");
            continue;
        }
        const bodyHoldsFootnote =
            reading.references.some((reference) => reference.line === block.start && reference.start >= bodyStart) ||
            reading.inlineNotesOn(block.start).some((note) => note.open >= bodyStart);
        if (bodyHoldsFootnote) {
            skip("its body holds a footnote");
            continue;
        }
        const its = refs.get(folded) ?? [];
        if (its.length === 0) {
            skip("nothing references it");
            continue;
        }
        if (its.some((ref) => ref.nested)) {
            skip("referenced from inside another footnote");
            continue;
        }
        eligible.push({ block, body: sanitizeInlineFootnoteContent(body), refs: its });
    }
    skipped.sort((a, b) => a.line - b.line);
    const named = skipped.map(({ name, reason }) => ({ name, reason }));
    if (eligible.length === 0) return unchanged(named);

    // the replacements, rightmost first on each line so that one keeps the
    // offsets of the ones before it
    const replacements = new Map<number, { start: number; end: number; text: string }[]>();
    for (const { body, refs: its } of eligible) {
        for (const ref of its) {
            // a pipe inside a table row's cell ends the cell, so it is
            // escaped there, the way Obsidian itself writes one
            const inline = `^[${tableRows[ref.line] ? body.replace(/\\[\s\S]|\|/g, (m) => (m === "|" ? "\\|" : m)) : body}]`;
            replacements.set(ref.line, [...(replacements.get(ref.line) ?? []), { start: ref.start, end: ref.end, text: inline }]);
        }
    }
    const replaced = lines.map((line, i) => {
        const edits = replacements.get(i);
        if (!edits) return line;
        return edits
            .sort((a, b) => b.start - a.start)
            .reduce((kept, edit) => kept.slice(0, edit.start) + edit.text + kept.slice(edit.end), line);
    });
    // The promise the orphan rules and the delete command make: a rewrite
    // that changes how Obsidian reads a line it was not asked to touch is
    // refused whole rather than half done.
    const byHand = "Converting would change how Obsidian reads the text around a footnote. Convert it by hand.";
    if (readsDifferently(lines, replaced, "rewrite")) return unchanged(named, byHand);
    const dead = eligible.map(({ block }) => block).sort((a, b) => a.start - b.start);
    const out = removeLineRanges(replaced, dead);
    if (linesReadDifferently(replaced, { lines: replaced, ranges: dead }, out)) return unchanged(named, byHand);

    return {
        markdown: restoreEol(out.join("\n"), eol),
        converted: eligible.length,
        references: eligible.reduce((n, { refs: its }) => n + its.length, 0),
        duplicated: eligible.filter(({ refs: its }) => its.length > 1).length,
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
 * its definition appended, in ONE transaction. Identical bodies (after
 * trimming) share one definition. Numbering continues past the note's
 * numbered footnotes and carries the note's prefix when that feature is
 * on, exactly as a creation press would. Where the definitions land is
 * the creation press's own decision (buildDefinitionAppend): after the
 * last definition block, under the section heading, or at the end of the
 * note.
 *
 * Left alone, and counted in the result: an empty inline footnote (a
 * definition with no body is a footnote still being written), and one
 * inside a definition's body, where a reference would nest footnotes
 * (ADR 1). One whose body runs onto the next line is not converted: the
 * note reading lists only the inline footnotes that start and end on one
 * line. Protected text is never read.
 *
 * Then the lint-on-creation trigger runs when that setting is on, as it
 * does after every press that creates a footnote.
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
    // every convertible inline footnote, in document order, with its
    // body's key for merging (the body as written, trimmed)
    const spans: { line: number; open: number; close: number; body: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const span of ctx.reading().inlineNotesOn(i)) {
            const body = lines[i].slice(span.open + 2, span.close).trim();
            if (body === "") {
                skip("empty");
                continue;
            }
            if (insideDefinition[i]) {
                skip("inside a footnote definition");
                continue;
            }
            spans.push({ line: i, open: span.open, close: span.close, body });
        }
    }
    if (spans.length === 0) {
        showNotice(
            skipped.length === 0
                ? "No inline footnotes to convert."
                : `No inline footnotes converted: skipped ${skippedList(skipped)}.`,
        );
        return { ...nothingToConvert, skipped };
    }

    // one id per distinct body, in order of first appearance: numbered the
    // way a creation press numbers, or, when the setting says so, named
    // after the first meaningful word of the body (Jason, 2026-09-22),
    // with a number for a body that offers no word; an invalid prefix has
    // already been toasted by activeFootnotePrefix
    const prefix = activeFootnotePrefix(plugin, footnotePrefixFromEditor(doc));
    if (prefix === null) return { ...nothingToConvert, skipped };
    let nextNumber = computeNextFootnoteNumber(ctx.reading(), prefix);
    const named = plugin.settings.footnoteNaming === "named";
    // every name the note uses, folded, so a generated name never collides
    const taken = new Set<string>();
    if (named) {
        for (const name of listExistingFootnoteDefinitions(doc, ctx)) taken.add(name.toLowerCase());
        for (let i = 0; i < lines.length; i++) {
            for (const occurrence of ctx.reading().referencesOn(i)) taken.add(occurrence.name.toLowerCase());
        }
    }
    const idOf = new Map<string, string>();
    const bodies: string[] = [];
    for (const span of spans) {
        if (idOf.has(span.body)) continue;
        const name = (named ? nameForBody(span.body, taken, prefix) : null) ?? `${prefix}${nextNumber++}`;
        taken.add(name.toLowerCase());
        idOf.set(span.body, name);
        bodies.push(span.body);
    }
    const ids = bodies.map((body) => idOf.get(body) as string);

    // the reference replacements, plus the definitions as ONE append: the
    // creation press's own append for the first id, seeded with its body,
    // then the other labels on the lines after it, planned against the
    // note with the references already in (see planDefinitionAppend)
    const edits: EditorChange[] = spans.map((span) => ({
        from: { line: span.line, ch: span.open },
        to: { line: span.line, ch: span.close + 1 },
        text: `[^${idOf.get(span.body) as string}]`,
    }));
    const plan = planDefinitionAppend({
        lines,
        edits,
        footnoteId: ids[0],
        plugin,
        body: bodies[0],
        moreDefinitionLines: ids.slice(1).map((id, k) => `${definitionLabel(id)} ${bodies[k + 1]}`),
    });
    doc.transaction({ changes: plan.changes });

    const result: ConversionToNormal = {
        converted: spans.length,
        definitions: ids.length,
        merged: spans.length - ids.length,
        skipped,
    };
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    showNotice(
        `Converted ${plural(result.converted, "inline footnote")} into ${plural(result.definitions, "normal footnote")}` +
            (result.merged > 0 ? ` (${plural(result.merged, "identical body")} merged)` : "") +
            "." +
            (skipped.length > 0 ? ` Skipped ${skippedList(skipped)}.` : ""),
    );
    // anything that creates a footnote lints, when that setting is on;
    // otherwise the alerts alone speak (ADR 2)
    if (lintAfterFootnoteCreation(plugin, doc, false) === null && !plugin.settings.lintOnFootnoteCreation) {
        noticeLintAlerts(plugin, doc.getValue());
    }
    return result;
}

/** "1 empty, 2 inside a footnote definition" */
function skippedList(skipped: { reason: string; count: number }[]): string {
    return skipped.map((s) => `${s.count} ${s.reason}`).join(", ");
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
 * name and reason, then the lint alerts.
 */
export async function convertNormalToInlineCommand(plugin: FootnotePlugin) {
    await withEditableEditor(plugin, (doc) => {
        runOutsideTableCell(doc, () => {
            const before = doc.getValue();
            const result = convertNormalFootnotesToInline(before);
            const skippedText =
                result.skipped.length > 0
                    ? ` Skipped ${result.skipped.map((s) => `${quotedReference(s.name)} (${s.reason})`).join(", ")}.`
                    : "";
            if (result.refused) {
                showNotice(`Nothing was converted. ${result.refused}${skippedText}`, 8000);
                return;
            }
            if (result.converted === 0) {
                showNotice(result.skipped.length === 0 ? "No footnotes to convert." : `No footnotes converted.${skippedText}`, 8000);
                return;
            }
            const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? undefined;
            // the section heading goes when every definition became inline
            // and the setting says so (Jason, 2026-09-25)
            const markdown = withEmptySectionHeadingRemoved(plugin, result.markdown);
            replaceMinimal(doc, before, markdown, mdView);
            const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
            showNotice(
                `Converted ${plural(result.converted, "footnote")} into inline footnotes at ${plural(result.references, "reference")}` +
                    (result.duplicated > 0
                        ? ` (${plural(result.duplicated, "definition")} used more than once became copies)`
                        : "") +
                    "." +
                    skippedText,
                result.skipped.length > 0 ? 8000 : undefined,
            );
            noticeLintAlerts(plugin, markdown);
        });
    }, "Move the cursor into the note's text to convert its footnotes.");
}
