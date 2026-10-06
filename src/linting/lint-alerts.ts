import type FootnotePlugin from "../main";
import { footnotePrefix, footnotePrefixProblem } from "../parsing/footnote-prefix";
import { definitionLabelWithName } from "../parsing/label-shapes";
import { normalizeEol } from "../parsing/line-edits";
import { readNote } from "../parsing/note-reading";
import {
    escapedAt,
    footnoteNameProblem,
    InvalidNameCharacters,
    quotedDefinitionLabel,
    quotedReference,
    referenceShapes,
    referenceText,
} from "../parsing/footnote-grammar";
import { duplicateFootnoteDefinitionNames, mergeDuplicateFootnoteDefinitions } from "./rules/merge-duplicate-definitions";
import { definitionsHoldingTheMoveBack } from "./rules/move-footnotes-to-the-bottom";
import {
    definitionsHeldBy,
    orphanedFootnoteDefinitionNames,
    removeOrphanedFootnoteDefinitions,
} from "./rules/remove-orphaned-definitions";
import {
    lazyDefinitionLabelNames,
    underlinedDefinitionLabelNames,
    orphanedFootnoteReferenceNames,
    removeOrphanedFootnoteReferences,
} from "./rules/remove-orphaned-references";

import { addReferenceOrDeleteDefinition, showNotice } from "../editor/notice";
// The lint alerts, shown after a lint has run. Every way of starting a lint
// ends here, reporting what the rules could not fix, or were not allowed
// to: empty "[^]" placeholders, orphans while their delete toggles are off,
// duplicates while merging is off.
//
// An alert only reports; it never changes the note, so it is not a lint
// rule. The 2026-08-07 mandate that rules stay independent of each other is
// about the chain of rules that rewrite the text, which lives in linter.ts.
// This file was split out of linter.ts on 2026-08-12.

/**
 * How many unnamed footnote references the note has, outside code and
 * frontmatter.
 *
 * There are two shapes. The plain empty "[^]", and, when `prefix` is given,
 * the same thing in a note that uses prefixes: a bare prefix with nothing
 * after it, such as "[^3.]" in a note whose prefix is "3.".
 *
 * Both are footnotes the user started and never finished naming. No rule can
 * fix them: "[^]" does not match the reference patterns at all, and a bare
 * prefix is impossible to tell from a name somebody chose. So the lint says
 * so instead, and the user should name or delete the fragment.
 */
export function countEmptyFootnoteReferences(markdown: string, prefix = ""): number {
    // Obsidian matches footnote names without regard to case, and so does
    // every other prefix comparison in the plugin, so "[^P.]" under the
    // prefix "p." is the placeholder too (Kimi sweep 2026-09-13).
    const folded = prefix.toLowerCase();
    // This runs on every single lint and most notes have neither shape in
    // them, so a note without one is settled before it is read (speed fix
    // F4).
    const haystack = markdown.toLowerCase();
    if (!haystack.includes("[^]") && (prefix === "" || !haystack.includes(referenceText(folded)))) return 0;
    const lines = normalizeEol(markdown).text.split("\n");
    const reading = readNote(lines);
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
        // "[^]" is no reference to the reading, so it is found on the
        // masked twin, where protected text holds none
        const masked = reading.maskedLine(i);
        for (let at = 0; (at = masked.indexOf("[^]", at)) !== -1; at += "[^]".length) {
            // a backslash in front of the "[" makes it literal text, as
            // everywhere else in the plugin: "\[^]" is prose about footnote
            // syntax, not an abandoned placeholder (Kimi hunt cycle 1,
            // 2026-09-16; renders literally in Reading view)
            if (escapedAt(masked, at)) continue;
            // "[^](https://x.y)" is a link whose text is a caret, and
            // Obsidian renders it as a link; a "[^]" that any link takes in
            // is that link's text, not a placeholder (hunt 2026-10-02, pin
            // bug-lint-caret-link-counted-unnamed)
            if (reading.insideLink(i, at)) continue;
            // "^[^]" is an inline footnote whose body is a caret, and a
            // "[^]" inside a longer inline footnote's body is that body's
            // literal text: Reading view renders both as inline footnotes
            // (Kimi hunt cycle 4, probed 2026-09-16), so neither is a
            // placeholder the user abandoned. That holds for an inline
            // footnote that runs over a line break too, so the lookup is
            // the one that takes those in (hunt 2026-10-05, round 2, pin
            // bug-alerts-multi-line-inline).
            if (reading.inlineNoteHolding(i, at) !== null) continue;
            count++;
        }
        // the bare prefix is a live reference to the reading, so its own
        // definition label and a copy in an inline footnote are left out
        if (prefix !== "") count += reading.referencesOn(i).filter((reference) => reference.name.toLowerCase() === folded).length;
    }
    return count;
}

/**
 * The note's own prefix, so the alerts can also count its bare-prefix
 * placeholder. Empty unless the prefix feature is on and the note's prefix
 * is valid.
 */
export function orphanSafePrefixFor(
    plugin: FootnotePlugin,
    markdown: string,
): string {
    if (!plugin.settings.enableFootnotePrefix) return "";
    const prefix = footnotePrefix(markdown);
    return prefix && footnotePrefixProblem(prefix) === null ? prefix : "";
}

// Unlike the orphan and duplicate alerts, this one is not tied to a
// setting. No rule is ever allowed to delete an empty reference, so there
// is no toggle that could make this alert unnecessary; it always speaks.
function noticeEmptyReferences(markdown: string, prefix: string) {
    const count = countEmptyFootnoteReferences(markdown, prefix);
    if (count === 0) return;
    const hint = prefix ? `"[^]" or the bare prefix "[^${prefix}]"` : '"[^]"';
    showNotice(
        count === 1
            ? `This note has an unnamed footnote reference (${hint}). Give it a name or delete it.`
            : `This note has ${count} unnamed footnote references (${hint}). Give them names or delete them.`,
        8000,
    );
}

/**
 * Format names for a notice as `"[^a]", "[^b]", "[^c]"`.
 *
 * EVERY name is spelled out, each in quotes, matching every other notice
 * that names a footnote (Jason asked for that consistency, 2026-09-04). The
 * list used to stop after three names and trail off; the user needs all of
 * them to go and fix them (his L-series pass, 2026-09-08).
 */
function referenceList(names: string[]): string {
    return names.map(quotedReference).join(", ");
}

/**
 * The same list in label form, `"[^a]:", "[^b]:"`. Used by the one alert
 * whose fix is made on the label LINE itself.
 */
function labelList(names: string[]): string {
    return names.map(quotedDefinitionLabel).join(", ");
}

// A "[^x]:" line directly under a line of prose is not a definition to
// Obsidian; it is more paragraph text (the prose-label rule, 2026-09-09).
// The definition the user typed is one blank line short of existing.
//
// These need their own alert because the general missing-definition alert
// would tell the user to "write its definition", which is the wrong advice:
// they already wrote it. So these names get this alert and are left out of
// that one. The orphan rule exempts them too, from its alert and from
// deletion alike. Like every alert, this one is never silent.
function noticeLazyDefinitions(lines: string[]) {
    const names = lazyDefinitionLabelNames(lines);
    if (names.length === 0) return;
    showNotice(
        names.length === 1
            ? `This note has a footnote definition that Obsidian reads as plain text because there is no blank line above it (${labelList(names)}). Add a blank line above it.`
            : `This note has ${names.length} footnote definitions that Obsidian reads as plain text because there is no blank line above them (${labelList(names)}). Add a blank line above each.`,
        8000,
    );
}

// A "[^x]:" line with a setext underline ("===", "---", "--") directly
// under it is a heading to Obsidian, not a definition, and inside a longer
// paragraph it is plain text that a blank line above would turn into a
// heading. Either way the blank line that helps is the one BETWEEN the
// label and the underline, so these labels get their own alert and are
// left out of the lazy one and its fix (Kimi hunt cycle 3, probed in
// Reading view 2026-09-16). Never silent, like every alert. Jason
// approved the wording on 2026-09-20.
function noticeUnderlinedDefinitions(lines: string[]) {
    const names = underlinedDefinitionLabelNames(lines);
    if (names.length === 0) return;
    showNotice(
        names.length === 1
            ? `This note has a footnote definition that Obsidian reads as a heading because a line of "=" or "-" sits right under it (${labelList(names)}). Put a blank line between the definition and that line.`
            : `This note has ${names.length} footnote definitions that Obsidian reads as headings because a line of "=" or "-" sits right under them (${labelList(names)}). Put a blank line between each definition and that line.`,
        8000,
    );
}

// Why the lint left an orphan in place with its delete toggle on, in one
// general sentence that names no cause, so a new reason for leaving one
// never makes the text wrong (Jason, 2026-10-05; hunt 2026-10-05, pin
// spec-callout-title-orphan-alert-wording, where it blamed a comment's
// closer for a definition on a callout's title). `them` is "it" or "them";
// `doing` is what the lint held back from, deleting unless it says moving
// (the move alert, Jason's triage decision Q5, 2026-10-05).
function leftInPlace(them: "it" | "them", doing: "deleting" | "moving" = "deleting"): string {
    return `the lint left ${them} in place, because ${doing} ${them} would change how Obsidian reads the lines around ${them}.`;
}

// Why the lint left a duplicate's copies alone with merging on (Jason,
// 2026-10-05; see noticeDuplicateDefinitions).
const MergeLeftAsTheyAre = "the lint left them as they are, because merging them would change how Obsidian reads the lines around them.";

// The alert half of "Delete orphaned references". While that toggle is off,
// the lint reports orphaned references instead of deleting them: an orphan
// is never passed over in silence.
//
// With the toggle ON, an orphan that is still in the note after the lint
// is one the rule REFUSED to delete, because taking it out would change how
// a line near it is read (the reclassification guard in
// remove-orphaned-references.ts). The alert used to assume the toggle had
// dealt with every orphan and said nothing, so the survivor was neither
// deleted nor reported, on that save and every later one (Kimi and Claude
// sweeps 2026-09-13; ADR 2, lint is never silent). Now it says the rule
// left it, and why. A single-rule command such as Move definitions to
// bottom also ends here, and an orphan a full lint WOULD delete is not
// reported after one of those: the next lint takes it, as before.
//
// That holds only for text a lint, or one of its rules, has just
// produced. After a command that runs no lint at all (Delete footnote
// everywhere, a conversion, a carried paste with Lint on footnote creation
// off), `afterLint` is false, and the alert speaks as it does with the
// toggle off: nothing has deleted the orphan, and nothing may until the
// user lints (hunt 2026-10-02, round 4, cluster A4, pin
// bug-lint-delete-everywhere-orphan-unreported).
function noticeOrphanedReferences(
    plugin: FootnotePlugin,
    markdown: string,
    prefix: string,
    precomputed: { lines: string[] },
    afterLint: boolean,
) {
    // a reference whose name is invalid (a "#", a backtick) is the
    // invalid-name alert's to report; naming it here as well would ask
    // the user to write a definition that could never bind (Jason's
    // ruling 2026-09-20, from the pruned lint-alerts sheet)
    let names = orphanedFootnoteReferenceNames(markdown, prefix, precomputed).filter(
        (name) => footnoteNameProblem(name) === null,
    );
    if (names.length === 0) return;
    if (afterLint && plugin.settings.lintDeleteOrphanedReferences) {
        // Each orphan is judged on its own by the rule now (Kimi hunt
        // cycle 4, 2026-09-16), so the ones it would still leave are the
        // refused ones: those are named, and one the next lint deletes is
        // not.
        const after = removeOrphanedFootnoteReferences(markdown, prefix);
        if (after !== markdown) {
            const left = new Set(orphanedFootnoteReferenceNames(after, prefix).map((n) => n.toLowerCase()));
            names = names.filter((name) => left.has(name.toLowerCase()));
        }
        if (names.length === 0) return;
        showNotice(
            names.length === 1
                ? `This note has a footnote reference with no definition (${referenceList(names)}), and ${leftInPlace("it")} Write its definition or delete the reference by hand.`
                : `This note has ${names.length} footnote references with no definition (${referenceList(names)}), and ${leftInPlace("them")} Write their definitions or delete the references by hand.`,
            8000,
        );
        return;
    }
    showNotice(
        names.length === 1
            ? `This note has a footnote reference with no definition (${referenceList(names)}). Write its definition or delete the reference.`
            : `This note has ${names.length} footnote references with no definition (${referenceList(names)}). Write their definitions or delete the references.`,
        8000,
    );
}

// Orphaned definitions that were kept get an alert as well (ruling: Jason,
// 2026-08-10). Every kind of orphan is either deleted or reported; none is
// quietly left in place. `afterLint` works as for orphaned references
// above: after Delete footnote everywhere, a definition only the deleted
// footnote's text cited is named even with the toggle on.
function noticeOrphanedDefinitions(
    plugin: FootnotePlugin,
    markdown: string,
    precomputed: { lines: string[] },
    afterLint: boolean,
) {
    let names = orphanedFootnoteDefinitionNames(markdown, precomputed);
    if (names.length === 0) return;
    if (afterLint && plugin.settings.lintDeleteOrphanedDefinitions) {
        // With the toggle ON, an orphaned definition still in the note is
        // one the rule refused to cut (the cut would change how a nearby
        // line is read, take a callout's title or a comment's closer with
        // it, or take a definition nested inside it); say so rather than
        // pass it over (ADR 2; Kimi hunt cycle 2, 2026-09-16).
        // Each orphan is judged on its own by the rule now (cycle 4), so
        // the ones it would still leave are the refused ones: those are
        // named, and one the next lint deletes is not.
        const after = removeOrphanedFootnoteDefinitions(markdown);
        if (after !== markdown) {
            const left = new Set(orphanedFootnoteDefinitionNames(after).map((n) => n.toLowerCase()));
            names = names.filter((name) => left.has(name.toLowerCase()));
        }
        if (names.length === 0) return;
        showNotice(
            names.length === 1
                ? `This note has a footnote definition nothing references (${referenceList(names)}), and ${leftInPlace("it")} Add its reference in the text, or delete the definition by hand.`
                : `This note has ${names.length} footnote definitions nothing references (${referenceList(names)}), and ${leftInPlace("them")} Add their references in the text, or delete the definitions by hand.`,
            8000,
        );
        return;
    }
    showNotice(
        names.length === 1
            ? `This note has a footnote definition nothing references (${referenceList(names)}). ${addReferenceOrDeleteDefinition(names[0])}`
            : `This note has ${names.length} footnote definitions nothing references (${referenceList(names)}). Add their references in the text, or delete the definitions.`,
        8000,
    );
}

// The alert half of "Move footnotes to the bottom". The rule gathers every
// definition or none: when moving one of them would change how Obsidian
// reads the lines around it (a definition between two lists, whose move
// would join them), it leaves them all where they are. That used to happen
// without a word on every lint (hunt 2026-10-05 round 2, cluster L8; ADR 2,
// the lint is never silent). Now the definitions that held the move back
// are named, with the general "left in place" reason, so the user can
// move them by hand and let the next lint gather the rest (Jason's triage
// decision Q5, 2026-10-05). Only while the rule is on.
function noticeUngatheredDefinitions(plugin: FootnotePlugin, markdown: string) {
    if (!plugin.settings.lintMoveToBottom) return;
    const names = definitionsHoldingTheMoveBack(markdown);
    if (names.length === 0) return;
    showNotice(
        names.length === 1
            ? `This note has a footnote definition the lint could not move to the bottom (${referenceList(names)}), and ${leftInPlace("it", "moving")} Move it by hand, and the next lint gathers the rest.`
            : `This note has ${names.length} footnote definitions the lint could not move to the bottom (${referenceList(names)}), and ${leftInPlace("them", "moving")} Move them by hand, and the next lint gathers the rest.`,
        8000,
    );
}

// The alert half of "Merge duplicate definitions". While that toggle is
// off, the lint reports duplicates instead of merging them; like orphans,
// they are never passed over in silence (Jason's policy, 2026-08-12).
// Duplicates matter because Obsidian renders only the LAST definition of a
// name, so the earlier ones simply do not appear.
function noticeDuplicateDefinitions(
    plugin: FootnotePlugin,
    markdown: string,
    precomputed: { lines: string[] },
) {
    const names = duplicateFootnoteDefinitionNames(markdown, precomputed);
    if (names.length === 0) return;
    if (plugin.settings.lintMergeDuplicateDefinitions) {
        // With the toggle on, a duplicate the merge rule can still not
        // touch is one with a copy the merge never moves: on the line of a
        // "%%" comment's closer, holding a table, or inside a list item or a
        // quote. It is named rather than passed over (ADR 2; Kimi hunt
        // cycle 4, 2026-09-16), with one general reason, so a new case
        // never makes the text wrong (Jason, 2026-10-05, after the reason
        // named a closer or a table for a copy in a list item; hunt
        // 2026-10-05, pin bug-duplicate-alert-container-reason).
        // A duplicate the merge WOULD fix, left behind by a single-rule
        // command, waits for the next lint as before.
        if (mergeDuplicateFootnoteDefinitions(markdown) !== markdown) return;
        showNotice(
            names.length === 1
                ? `This note defines ${referenceList(names)} more than once, and ${MergeLeftAsTheyAre} Obsidian renders only the last definition. Merge them by hand.`
                : `This note defines ${names.length} footnotes more than once (${referenceList(names)}), and ${MergeLeftAsTheyAre} Obsidian renders only each one's last definition. Merge them by hand.`,
            8000,
        );
        return;
    }
    showNotice(
        names.length === 1
            ? `This note defines ${referenceList(names)} more than once. Obsidian renders only the last definition. Merge them, or turn on "Merge duplicate definitions".`
            : `This note defines ${names.length} footnotes more than once (${referenceList(names)}). Obsidian renders only each one's last definition. Merge them, or turn on "Merge duplicate definitions".`,
        8000,
    );
}

/**
 * The note's footnote names that a footnote is not allowed to have: ones
 * containing whitespace, backticks or "#". It looks at live references and
 * definition labels, and lists each name once, treating upper and lower
 * case as the same.
 *
 * Creating or renaming a footnote refuses such a name up front. But a name
 * the user typed by hand, or one that was already in the note, cannot be
 * fixed automatically: there is no telling which name they meant. So the
 * lint reports it instead (Jason's L-series pass, 2026-09-08).
 *
 * Fakes inside protected text do not count. A name holding a space is no
 * reference to Obsidian at all ("[^my note]" is plain text), so it is
 * found by its shape (referenceShapes); every other name comes from the
 * note reading's live references and definitions.
 */
export function invalidFootnoteNames(lines: string[]): string[] {
    const reading = readNote(lines);
    const names: string[] = [];
    const seen = new Set<string>();
    const consider = (name: string) => {
        const folded = name.toLowerCase();
        if (seen.has(folded) || footnoteNameProblem(name) === null) return;
        seen.add(folded);
        names.push(name);
    };
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes("[^")) continue;
        // the live references, and the names holding a space, which only
        // their shape shows, in the order they stand on the line
        const spaced = referenceShapes(lines[i], reading.maskedLine(i)).filter(({ name }) => /\s/.test(name));
        for (const { name } of [...reading.referencesOn(i), ...spaced].sort((a, b) => a.start - b.start)) consider(name);
    }
    // every definition's name, wherever it sits: a quoted one used to go
    // unchecked because only column-0 blocks were read (Kimi sweep
    // 2026-09-13), and one in a list item counts the same (Jason's ruling
    // 1, option a, 2026-10-03)
    for (const definition of reading.definitions) consider(definition.name);
    return names;
}

function noticeInvalidNames(lines: string[]) {
    const names = invalidFootnoteNames(lines);
    if (names.length === 0) return;
    showNotice(
        names.length === 1
            ? `This note has a footnote with an invalid name (${referenceList(names)}). ${InvalidNameCharacters}`
            : `This note has ${names.length} footnotes with invalid names (${referenceList(names)}). ${InvalidNameCharacters}`,
        8000,
    );
}

/**
 * The names of definitions that have another footnote INSIDE them: a live
 * reference or an inline footnote, either on the label line after the label
 * itself, or on one of the continuation lines, or another footnote's
 * definition on one of the continuation lines.
 *
 * A nested footnote is one footnote sitting inside another footnote's text.
 * The plugin refuses to create one anywhere (Jason's ruling, 2026-08-24,
 * after Discord confirmed nobody wants them). But nesting the user typed by
 * hand, or that was already in the note, cannot be undone automatically
 * without throwing text away, so the lint reports it instead. That is the
 * same never-silent policy orphans and duplicates follow.
 *
 * Fakes inside protected text do not count.
 */
export function nestedFootnoteDefinitionNames(lines: string[]): string[] {
    const reading = readNote(lines);
    const names: string[] = [];
    // One entry per NAME, ignoring case, the same way the duplicate and
    // orphan alerts do it. A name defined twice with both copies nested
    // used to be reported twice, which made the notice's count too high
    // (bug hunt, 2026-08-25).
    const seen = new Set<string>();
    // Every definition's text, wherever the definition sits: at the top
    // level, in a blockquote or callout (the C22 ruling; Kimi sweep
    // 2026-09-13), or in a list item (Jason's ruling 1, option a,
    // 2026-10-03; hunt 2026-10-02, cluster E7). Its text is the rest of its
    // label line after the label and the lines of its body.
    const spans = reading.definitions;
    for (const span of spans) {
        // a definition written inside this one's body is nesting too, and
        // the alert ADR 0001 promises for it used to stay silent (hunt
        // 2026-10-05, pin bug-nested-definition-deleted-with-outer)
        let nested = definitionsHeldBy(spans, span).length > 0;
        for (let i = span.start; i <= span.end && !nested; i++) {
            const startAt = i === span.start ? span.labelEnd : 0;
            // inlineNotesOn lists only the inline footnotes wholly on one
            // line. One that runs over a line break holds the end of the
            // line it opens on, so the definition holds one when one holds
            // the end of any of its lines. It can only have opened in the
            // definition's own text, since a paragraph never runs on into
            // a definition (hunt 2026-10-05, round 2, pin
            // bug-alerts-multi-line-inline).
            nested =
                reading.referencesOn(i).some((occurrence) => occurrence.start >= startAt) ||
                reading.inlineNotesOn(i).some((note) => note.open >= startAt) ||
                reading.inlineNoteHolding(i, lines[i].length) !== null;
        }
        if (nested && !seen.has(span.name.toLowerCase())) {
            seen.add(span.name.toLowerCase());
            names.push(span.name);
        }
    }
    return names;
}


function noticeNestedFootnotes(lines: string[]) {
    const names = nestedFootnoteDefinitionNames(lines);
    if (names.length === 0) return;
    showNotice(
        names.length === 1
            ? `This note has a footnote nested inside another footnote's definition (${referenceList(names)}). Nested footnotes don't survive export and most tools can't read them. Move it into the text.`
            : `This note has footnotes nested inside ${names.length} footnote definitions (${referenceList(names)}). Nested footnotes don't survive export and most tools can't read them. Move them into the text.`,
        8000,
    );
}

// Every way of starting a lint calls this with the text as it stands AFTER
// the lint, so the alerts speak whether or not any rule changed anything.
//
/**
 * The names of definitions written inside a "%%" block comment, in order,
 * each once. Obsidian never shows a definition there (its reference half
 * still counts, so the footnote may render from a real definition
 * elsewhere, or not at all), and the user almost certainly meant it to be
 * seen, so the lint names it (Jason's ruling A1, 2026-09-15).
 */
export function commentedDefinitionNames(markdown: string): string[] {
    const lines = normalizeEol(markdown).text.split("\n");
    const reading = readNote(lines);
    const names: string[] = [];
    const seen = new Set<string>();
    let offset = 0;
    for (let i = 0; i < lines.length; offset += lines[i].length + 1, i++) {
        if (!reading.commentLines[i] || reading.protectedLines[i]) continue;
        const hit = commentedLabel(lines[i], reading.maskedLine(i), reading.containerEnd(i));
        if (!hit) continue;
        // Only a label inside the comment is hidden: on the closer line the
        // text after the "%%" is outside it ("%%[^1]: def" renders a
        // footnote; GLM hunt cycle 5, probed in Reading view 2026-09-16),
        // and a label BEFORE the closer ("[^1]: dead %%") is hidden like any
        // interior line (Kimi hunt cycle 3, 2026-09-16)
        const at = offset + hit.start;
        if (!reading.comments.some((comment) => comment.block && comment.from <= at && at < comment.to)) continue;
        const folded = hit.name.toLowerCase();
        if (seen.has(folded)) continue;
        seen.add(folded);
        names.push(hit.name);
    }
    return names;
}

/**
 * The definition label on a line of a "%%" comment, as the line would read
 * with the comment taken away: its name as written and the column of its
 * "[". `textStart` is where the containers around the comment end
 * (containerEnd): a quote's marker, a list item's indentation, or the four
 * columns of a definition the comment is written in. The label is read
 * from there, as labelShapedLines reads a lazy label. Read from the
 * margin, a label in a comment indented inside a definition was four
 * columns in and no label to the alert (hunt 2026-10-02, round 4, pin
 * bug-lint-indented-commented-label-rewritten).
 *
 * Obsidian reads a comment's lines as hidden text, not as blocks, so the
 * note reading sees no list item inside one. A label behind a list marker
 * written in the comment ("- [^x]: hidden", "1. [^x]: hidden") is found
 * by reading that line on its own, which says what it would be outside the
 * comment: a definition in a list item, which counts like any other
 * (Jason's ruling 1, option a, 2026-10-03; hunt 2026-10-05, round 2, pin
 * bug-commented-item-definition-alert). That reading is asked only when
 * the line holds a label's shape past its start, so most commented lines
 * never need it.
 */
function commentedLabel(line: string, masked: string, textStart: number): { name: string; start: number } | null {
    const hit = definitionLabelWithName(line.slice(textStart), masked.slice(textStart));
    if (hit) return { name: hit.name, start: textStart + hit.label.nameStart - 2 };
    if (!/\[\^[^[\]\s]+\]:/.test(masked.slice(textStart))) return null;
    const own = readNote([line.slice(textStart)]).labelsOn(0).at(0);
    return own === undefined ? null : { name: own.name, start: textStart + own.start };
}

function noticeCommentedDefinitions(markdown: string) {
    const names = commentedDefinitionNames(markdown);
    if (names.length === 0) return;
    showNotice(
        names.length === 1
            ? `This note has a footnote definition inside a %% comment (${labelList(names)}), where Obsidian never shows it. Move it out of the comment.`
            : `This note has ${names.length} footnote definitions inside %% comments (${labelList(names)}), where Obsidian never shows them. Move them out of the comments.`,
        8000,
    );
}

// Whether `line`, right under a label, has the shape of another row of the
// table whose row `row` sits right above the label: it holds a pipe, is
// not itself a label, and starts with a pipe when that row does. The note
// reading's table rows answer the "row above" question, so a pipe-less GFM
// table ("a | b" over "--- | ---") counts like a piped one (Kimi hunt
// cycle 3, 2026-09-16: Reading view breaks both the same way, folding the
// rows after the label into the footnote's text). Under a table written
// with outer pipes, a sentence with a pipe in it ("where a|b is
// shorthand") is the footnote's own text, not a row someone typed there
// (hunt 2026-10-02, round 4, cluster A2, pin
// bug-lint-pipe-prose-false-in-table-alert).
const rowShaped = (line: string, row: string): boolean =>
    line.includes("|") && line.trim() !== "" && !/^ {0,3}\[\^/.test(line) && (!row.trimStart().startsWith("|") || line.trimStart().startsWith("|"));

/**
 * The names of definitions that sit INSIDE a table: a table row directly
 * above the label and another directly below it. Obsidian ends the table
 * at the label and folds the rows after it into the footnote's text as a
 * lazy continuation, so the table is broken either way. The plugin does
 * not move the label; it tells the user (Jason's ruling A2, 2026-09-15).
 */
export function definitionsInsideTableNames(markdown: string): string[] {
    const lines = normalizeEol(markdown).text.split("\n");
    const reading = readNote(lines);
    const rows = reading.tableRowLines;
    const names: string[] = [];
    const seen = new Set<string>();
    for (let i = 1; i + 1 < lines.length; i++) {
        const label = reading.labelOn(i);
        if (!label) continue;
        if (!rows[i - 1] || !rowShaped(lines[i + 1], lines[i - 1])) continue;
        const folded = label.name.toLowerCase();
        if (seen.has(folded)) continue;
        seen.add(folded);
        names.push(label.name);
    }
    return names;
}

function noticeDefinitionsInsideTables(markdown: string) {
    const names = definitionsInsideTableNames(markdown);
    if (names.length === 0) return;
    showNotice(
        names.length === 1
            ? `This note has a footnote definition inside a table (${labelList(names)}); the rows after it become part of the footnote's text. Move it below the table.`
            : `This note has ${names.length} footnote definitions inside tables (${labelList(names)}); the rows after each become part of its text. Move them below the tables.`,
        8000,
    );
}

// The line-ending normalize is done once here and shared by every alert,
// and the note reading (the parse, the masked twin, the definitions) is
// remembered per text, so each alert asks it at no extra cost.
// Each alert used to work them out again for itself, which came to about
// 40% of the time a lint took, noticeable on every footnote created with
// lint-on-footnote-creation on (2026-08-11 review, a speed fix). The
// definition starts were added to the shared bundle on 2026-09-09, when the
// prose-label rule turned out to have quietly added seven more repeats.
//
// `afterLint` says whether a lint, or one of its rules, produced
// `markdown`. A command that runs none passes false, so an alert that
// counts on a rule having had its turn speaks instead (see
// noticeOrphanedReferences).
export function noticeLintAlerts(plugin: FootnotePlugin, markdown: string, afterLint = true) {
    // Every one of the alerts is looking for text containing "[^", so a
    // note without those two characters anywhere cannot trigger any of them
    if (!markdown.includes("[^")) return;
    const prefix = orphanSafePrefixFor(plugin, markdown);
    const lines = normalizeEol(markdown).text.split("\n");
    noticeEmptyReferences(markdown, prefix);
    noticeOrphanedReferences(plugin, markdown, prefix, { lines }, afterLint);
    noticeLazyDefinitions(lines);
    noticeUnderlinedDefinitions(lines);
    noticeCommentedDefinitions(markdown);
    noticeDefinitionsInsideTables(markdown);
    noticeOrphanedDefinitions(plugin, markdown, { lines }, afterLint);
    noticeUngatheredDefinitions(plugin, markdown);
    noticeDuplicateDefinitions(plugin, markdown, { lines });
    noticeNestedFootnotes(lines);
    noticeInvalidNames(lines);
}
