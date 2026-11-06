import type FootnotePlugin from "../main";
import { footnotePrefix, footnotePrefixProblem } from "../parsing/footnote-prefix";
import { labelShapedLines, underlinedLazyLabelNames } from "../parsing/label-shapes";
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
import { configuredSectionHeading, heldByTheLint, lastLintHeldBack, lintOptionsFromSettings, sectionHeadingProblem } from "./linter";
import { labelInsideTable } from "./rewrite-document";
import { duplicateFootnoteDefinitionNames, mergeDuplicateFootnoteDefinitions } from "./rules/merge-duplicate-definitions";
import { definitionsHoldingTheMoveBack, sectionHeadingHeldBack } from "./rules/move-footnotes-to-the-bottom";
import {
    definitionsHeldBy,
    orphanedFootnoteDefinitionNames,
    removeOrphanedFootnoteDefinitions,
} from "./rules/remove-orphaned-definitions";
import {
    commentedDefinitionNames,
    lazyDefinitionLabelNames,
    underlinedDefinitionLabelNames,
    orphanedFootnoteReferenceNames,
    removeOrphanedFootnoteReferences,
} from "./rules/remove-orphaned-references";

import {
    addReferenceOrDeleteDefinition,
    addReferencesOrDeleteDefinitions,
    andList,
    lintLeft,
    moveIntoText,
    moveOutOfDefinition,
    SectionHeadingNotAdded,
    showNotice,
} from "../editor/notice";
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
 * Format names for a notice as `"[^a]", "[^b]", "[^c]"`, and an inline
 * footnote, which has no name, by its text: `"^[a note]"`.
 *
 * EVERY name is spelled out, each in quotes, matching every other notice
 * that names a footnote (Jason asked for that consistency, 2026-09-04). The
 * list used to stop after three names and trail off; the user needs all of
 * them to go and fix them (his L-series pass, 2026-09-08).
 */
function referenceList(names: string[]): string {
    return names.map(quotedName).join(", ");
}

/** One name as referenceList spells it. */
function quotedName(name: string): string {
    return name.startsWith("^[") ? `"${name}"` : quotedReference(name);
}

/**
 * The same list in label form, `"[^a]:", "[^b]:"`. Used by the one alert
 * whose fix is made on the label LINE itself.
 */
function labelList(names: string[]): string {
    return names.map(quotedDefinitionLabel).join(", ");
}

// A label line Obsidian does not read as a definition gets one alert, in
// one shape: what Obsidian reads it as, then the fix that applies (Jason's
// shared vocabulary, 2026-10-22). Three shapes need it:
//
// - A "[^x]:" line directly under a line of prose is plain text to
//   Obsidian, more of the paragraph (the prose-label rule, 2026-09-09):
//   the definition the user typed is one blank line short of existing.
//   The general missing-definition alert would tell the user to "write
//   its definition", which is the wrong advice, since they already wrote
//   it. So these names get this alert and are left out of that one; the
//   orphan rule exempts them too, from its alert and from deletion alike.
// - A "[^x]:" line with a setext underline ("===", "---", "--") directly
//   under it is a heading to Obsidian. The blank line that helps is the
//   one BETWEEN the label and the underline (Kimi hunt cycle 3, probed in
//   Reading view 2026-09-16).
// - A label right under a paragraph's text with a line of "-" or "=" under
//   it is plain text, and a blank line above alone would make it a
//   heading: it needs one above and one below (underlinedLazyLabelNames;
//   Jason's ruling Q9, 2026-10-07; pin bug-underlined-label-wide-item).
//   The other two leave its names to this one (`both`).
//
// Like every alert, these are never silent.

/** The alert for labels Obsidian reads as `readsAs` rather than as
 * definitions, ending with `fix`: the singular advice, then the plural. */
function noticeNotDefinitions(names: readonly string[], readsAs: "plain text" | "a heading", fix: [one: string, many: string]) {
    if (names.length === 0) return;
    const one = names.length === 1;
    const as = readsAs === "a heading" && !one ? "headings" : readsAs;
    showNotice(
        `Obsidian reads ${andList(names.map(quotedDefinitionLabel))} as ${as}, not as ${one ? "a footnote definition" : "footnote definitions"}. ${one ? fix[0] : fix[1]}`,
        8000,
    );
}

function noticeLazyDefinitions(lines: string[], both: ReadonlySet<string>) {
    const names = lazyDefinitionLabelNames(lines).filter((name) => !both.has(name.toLowerCase()));
    noticeNotDefinitions(names, "plain text", ["Put a blank line above it.", "Put a blank line above each."]);
}

function noticeUnderlinedDefinitions(lines: string[], both: ReadonlySet<string>) {
    const names = underlinedDefinitionLabelNames(lines).filter((name) => !both.has(name.toLowerCase()));
    noticeNotDefinitions(names, "a heading", [
        'Put a blank line between it and the line of "=" or "-" under it.',
        'Put a blank line between each and the line of "=" or "-" under it.',
    ]);
}

function noticeUnderlinedLazyDefinitions(names: readonly string[]) {
    noticeNotDefinitions(names, "plain text", ["Put a blank line above it and another below it.", "Put a blank line above and below each."]);
}

// The references, renames, and moves the lint left undone, because doing
// them would change how Obsidian reads the note, get one alert, after every
// other check has had its say (Jason's shared vocabulary, 2026-10-22). It
// names what was left, with one general sentence that names no cause (hunt
// 2026-10-05, pin spec-callout-title-orphan-alert-wording).
//
// Three things that were in this alert for a while have left it (Jason's
// choice, 2026-11-05). An orphaned definition and a duplicate need to say
// what is wrong with them, because "Fix it by hand" gives no clue otherwise.
// The section heading was never in the note, so it was not "left as it is".
// Those speak in their own alerts below.
//
// `left` holds what was left, quoted, in the order the checks found it:
// footnotes as "[^a]" and definitions as "[^a]:". `told` holds the labels an
// orphan or duplicate alert has already named, in lower case. A definition
// can also hold the move back, and it is not named a second time here, where
// its problem would go missing.
function noticeHeldBack(left: readonly string[], told: ReadonlySet<string>) {
    const items = [...new Set(left)].filter((item) => !told.has(item.toLowerCase()));
    if (items.length === 0) return;
    const one = items.length === 1;
    showNotice(`${lintLeft(andList(items), one, "changing")} ${one ? "Fix it by hand." : "Fix them by hand."}`, 8000);
}

/** The labels of the definitions an alert has just named, in lower case, for noticeHeldBack. */
function toldLabels(names: readonly string[]): string[] {
    return names.map((name) => quotedDefinitionLabel(name).toLowerCase());
}

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
// sweeps 2026-09-13; ADR 2, lint is never silent). Now it is returned for
// the held-back alert (noticeHeldBack). A single-rule command such as Move definitions to
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
): string[] {
    // a reference whose name is invalid (a "#", a backtick) is the
    // invalid-name alert's to report; naming it here as well would ask
    // the user to write a definition that could never bind (Jason's
    // ruling 2026-09-20, from the pruned lint-alerts sheet)
    let names = orphanedFootnoteReferenceNames(markdown, prefix, precomputed).filter(
        (name) => footnoteNameProblem(name) === null,
    );
    if (names.length === 0) return [];
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
        return names.map(quotedName);
    }
    showNotice(
        names.length === 1
            ? `This note has a footnote reference with no definition (${referenceList(names)}). Write its definition or delete the reference.`
            : `This note has ${names.length} footnote references with no definition (${referenceList(names)}). Write their definitions or delete the references.`,
        8000,
    );
    return [];
}

/** What is wrong with definitions nothing references, whichever alert says it. */
function orphanedDefinitionsProblem(names: string[]): string {
    return names.length === 1
        ? `This note has a footnote definition nothing references (${referenceList(names)}).`
        : `This note has ${names.length} footnote definitions nothing references (${referenceList(names)}).`;
}

// Orphaned definitions that were kept get an alert as well (ruling: Jason,
// 2026-08-10). Every kind of orphan is either deleted or reported; none is
// quietly left in place. `afterLint` works as for orphaned references
// above: after Delete footnote everywhere, a definition only the deleted
// footnote's text cited is named even with the toggle on. It returns the
// labels of the ones the lint tried to delete, for noticeHeldBack.
function noticeOrphanedDefinitions(
    plugin: FootnotePlugin,
    markdown: string,
    precomputed: { lines: string[] },
    afterLint: boolean,
): string[] {
    let names = orphanedFootnoteDefinitionNames(markdown, precomputed);
    if (names.length === 0) return [];
    if (afterLint && plugin.settings.lintDeleteOrphanedDefinitions) {
        // With the toggle ON, an orphaned definition still in the note is
        // one the rule refused to cut (the cut would change how a nearby
        // line is read, take a callout's title or a comment's closer with
        // it, or take a definition nested inside it). The alert says so
        // rather than passing over it (ADR 2; Kimi hunt cycle 2,
        // 2026-09-16), and says what is wrong with it (Jason, 2026-11-05).
        // Each orphan is judged on its own by the rule now (cycle 4), so
        // the ones it would still leave are the refused ones: those are
        // named, and one the next lint deletes is not.
        const after = removeOrphanedFootnoteDefinitions(markdown);
        if (after !== markdown) {
            const left = new Set(orphanedFootnoteDefinitionNames(after).map((n) => n.toLowerCase()));
            names = names.filter((name) => left.has(name.toLowerCase()));
        }
        if (names.length === 0) return [];
        const one = names.length === 1;
        showNotice(
            `${orphanedDefinitionsProblem(names)} ${lintLeft(one ? "it" : "them", one, "deleting")} ${one ? addReferenceOrDeleteDefinition(names[0], true) : addReferencesOrDeleteDefinitions(true)}`,
            8000,
        );
        return toldLabels(names);
    }
    showNotice(
        `${orphanedDefinitionsProblem(names)} ${names.length === 1 ? addReferenceOrDeleteDefinition(names[0]) : addReferencesOrDeleteDefinitions()}`,
        8000,
    );
    return [];
}

// The alert half of "Move footnotes to the bottom". The rule gathers every
// definition or none: when moving one of them would change how Obsidian
// reads the lines around it (a definition between two lists, whose move
// would join them), it leaves them all where they are. That used to happen
// without a word on every lint (hunt 2026-10-05 round 2, cluster L8; ADR 2,
// the lint is never silent). Now the definitions that held the move back
// are returned for the held-back alert, so the user can move them by hand
// and let the next lint gather the rest (Jason's triage decision Q5,
// 2026-10-05). Only while the rule is on. The gathering is
// worked out under the section heading the lint uses, which it drops when
// the heading holds a reference (hunt 2026-10-06, cycle 5, pin
// bug-move-alert-ignores-heading).
function ungatheredDefinitions(plugin: FootnotePlugin, markdown: string): string[] {
    if (!plugin.settings.lintMoveToBottom) return [];
    return definitionsHoldingTheMoveBack(markdown, headingTheMoveUses(plugin)).map(quotedDefinitionLabel);
}

/** The section heading the move to the bottom works with: the one in the settings, or none when that one cannot be used. */
function headingTheMoveUses(plugin: FootnotePlugin): string {
    const configured = configuredSectionHeading(plugin);
    return sectionHeadingProblem(configured) === null ? configured : "";
}

// A section heading the move could not add gets an alert of its own, since
// the heading is the one thing the user cannot add by hand: it comes from the
// settings (Jason's ruling 2, 2026-10-09; pin bug-held-section-heading-silent).
function noticeSectionHeadingNotAdded(plugin: FootnotePlugin, markdown: string) {
    if (plugin.settings.lintMoveToBottom && sectionHeadingHeldBack(markdown, headingTheMoveUses(plugin))) {
        showNotice(SectionHeadingNotAdded, 8000);
    }
}

// The changes the result gate held back inside the punctuation rule, apply
// prefix, and reindex, where the note after the lint does not show them:
// a reference left on the wrong side of its punctuation, a footnote left
// without the note's prefix, footnotes reindex left unnumbered or unnamed,
// and definitions it left out of order. Each used to be held back without a word
// (ADR 0002, the lint is never silent; stage 5 of the result gate
// design, 2026-10-08). They are returned for the held-back alert:
// references and renamed footnotes as "[^a]", definitions left out of
// order as "[^a]:". Only after a lint that held something back
// (lastLintHeldBack), since a lint the gate passed whole held nothing.
function heldChanges(plugin: FootnotePlugin, markdown: string, afterLint: boolean): string[] {
    if (!afterLint || !lastLintHeldBack(markdown)) return [];
    const heading = configuredSectionHeading(plugin);
    const held = heldByTheLint(markdown, lintOptionsFromSettings(plugin, sectionHeadingProblem(heading) === null ? heading : "", markdown));
    return [
        ...(held.get("punctuation") ?? []).map(quotedName),
        ...(held.get("prefix") ?? []).map(quotedName),
        ...(held.get("rename") ?? []).map(quotedName),
        ...(held.get("order") ?? []).map(quotedDefinitionLabel),
    ];
}

/** What is wrong with definitions of one name written several times, whichever alert says it. */
function duplicateDefinitionsProblem(names: string[]): string {
    return names.length === 1
        ? `This note defines ${referenceList(names)} more than once. Obsidian renders only the last definition.`
        : `This note defines ${names.length} footnotes more than once (${referenceList(names)}). Obsidian renders only each one's last definition.`;
}

// The alert half of "Merge duplicate definitions". While that toggle is
// off, the lint reports duplicates instead of merging them; like orphans,
// they are never passed over in silence (Jason's policy, 2026-08-12).
// Duplicates matter because Obsidian renders only the LAST definition of a
// name, so the earlier ones simply do not appear.
//
// `afterLint` works as for orphaned references (noticeOrphanedReferences).
// After a command that runs no lint at all (Delete footnote everywhere, a
// conversion, a carried paste with Lint on footnote creation off), nothing
// has merged the duplicates, so the alert speaks as it does with the toggle
// off, less its advice to turn the toggle on (run toast-bugs, 2026-10-22,
// pin bug-duplicate-alert-silent-without-lint). It returns the labels of the
// ones the lint could not merge, for noticeHeldBack.
function noticeDuplicateDefinitions(
    plugin: FootnotePlugin,
    markdown: string,
    precomputed: { lines: string[] },
    afterLint: boolean,
): string[] {
    const names = duplicateFootnoteDefinitionNames(markdown, precomputed);
    if (names.length === 0) return [];
    const merging = plugin.settings.lintMergeDuplicateDefinitions;
    if (merging && afterLint) {
        // With the toggle on, a duplicate the merge rule can still not
        // touch is one with a copy the merge never moves: on the line of a
        // "%%" comment's closer, holding a table, or inside a list item or a
        // quote. The alert says so rather than passing over it (ADR 2; Kimi
        // hunt cycle 4, 2026-09-16), and says what is wrong with it (Jason,
        // 2026-11-05), with one general reason, so a new case
        // never makes the text wrong (Jason, 2026-10-05, after the reason
        // named a closer or a table for a copy in a list item; hunt
        // 2026-10-05, pin bug-duplicate-alert-container-reason).
        // A duplicate the merge would still fix is left to the next lint,
        // which merges it.
        if (mergeDuplicateFootnoteDefinitions(markdown) !== markdown) return [];
        showNotice(`${duplicateDefinitionsProblem(names)} ${lintLeft("them", false, "merging")} Merge them by hand.`, 8000);
        return toldLabels(names);
    }
    const advice = merging ? "Merge them." : `Merge them, or turn on "Merge duplicate definitions".`;
    showNotice(`${duplicateDefinitionsProblem(names)} ${advice}`, 8000);
    return [];
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
 * Fakes inside protected text do not count, and neither does the "[^2]"
 * of a lazy label (a label Obsidian reads as plain text carrying on the
 * text above it). A label typed straight under a footnote longer than
 * Obsidian's 1,024-character look-ahead is one: Obsidian reads it as more
 * of the long footnote, so its "[^2]" sits inside that footnote's text.
 * What the user meant is a footnote beside the long one, and the alert
 * that helps is the lazy-label one, "Add a blank line above it". This
 * alert used to say a footnote was nested in the long one as well (hunt
 * 2026-10-08, cycle 7, cluster Y7; pin bug-nested-alert-on-lazy-label).
 * A reference after the label on its line still counts.
 */
export function nestedFootnoteDefinitionNames(lines: string[]): string[] {
    return nestedFootnotes(lines).map(({ outer }) => outer);
}

/** One definition and what is nested inside it (nestedFootnotes). */
interface NestedFootnotes {
    outer: string;
    inner: string[];
    labels: string[];
}

/**
 * The same definitions, each with what is nested inside it, so the alert
 * can name both (Jason, 2026-10-22): `outer` is the definition's name, and
 * `inner` lists what it holds, quoted the way the alert says it, in the
 * order the note reads them: a reference as "[^b]", an inline footnote by
 * its text as "^[text]", and a definition written in its body as "[^b]:".
 * `labels` holds that last kind again, since their advice differs.
 */
function nestedFootnotes(lines: string[]): NestedFootnotes[] {
    const reading = readNote(lines);
    // The lines a lazy label starts. Finding them reads the note again, so
    // it is done only once a definition holds a reference. A lazy label
    // starts its line's text, so its "[^2]" is the line's first reference.
    let lazyLabelLines: Set<number> | undefined;
    const startsLazyLabel = (line: number, index: number) =>
        index === 0 && (lazyLabelLines ??= new Set(labelShapedLines(lines, undefined, reading).map((label) => label.line))).has(line);
    const found: NestedFootnotes[] = [];
    // One entry per NAME, ignoring case, the same way the duplicate and
    // orphan alerts do it. A name defined twice with both copies nested
    // used to be reported twice, which made the notice's count too high
    // (bug hunt, 2026-08-25). The second copy's nested footnotes join the
    // first's.
    const byName = new Map<string, NestedFootnotes>();
    // an inline footnote's text as the note has it, over its lines
    const inlineText = (note: { line: number; open: number; closeLine: number; close: number }) =>
        `"${lines.slice(note.line, note.closeLine + 1).map((line, k, all) => line.slice(k === 0 ? note.open : 0, k === all.length - 1 ? note.close + 1 : line.length)).join(" ")}"`;
    // Every definition's text, wherever the definition sits: at the top
    // level, in a blockquote or callout (the C22 ruling; Kimi sweep
    // 2026-09-13), or in a list item (Jason's ruling 1, option a,
    // 2026-10-03; hunt 2026-10-02, cluster E7). Its text is the rest of its
    // label line after the label and the lines of its body.
    const spans = reading.definitions;
    for (const span of spans) {
        const inner: { line: number; at: number; text: string }[] = [];
        // a definition written inside this one's body is nesting too, and
        // the alert ADR 0001 promises for it used to stay silent (hunt
        // 2026-10-05, pin bug-nested-definition-deleted-with-outer)
        const held = definitionsHeldBy(spans, span);
        for (const { start, name } of held) inner.push({ line: start, at: -1, text: quotedDefinitionLabel(name) });
        for (let i = span.start; i <= span.end; i++) {
            const startAt = i === span.start ? span.labelEnd : 0;
            reading.referencesOn(i).forEach((occurrence, index) => {
                if (occurrence.start >= startAt && !startsLazyLabel(i, index)) inner.push({ line: i, at: occurrence.start, text: quotedReference(occurrence.name) });
            });
            for (const note of reading.inlineNotesOn(i)) {
                if (note.open >= startAt) inner.push({ line: i, at: note.open, text: `"${lines[i].slice(note.open, note.close + 1)}"` });
            }
            // inlineNotesOn lists only the inline footnotes wholly on one
            // line. One that runs over a line break holds the end of the
            // line it opens on, so the definition holds one when one holds
            // the end of the line it opens on. It can only have opened in
            // the definition's own text, since a paragraph never runs on
            // into a definition (hunt 2026-10-05, round 2, pin
            // bug-alerts-multi-line-inline).
            const running = reading.inlineNoteHolding(i, lines[i].length);
            if (running !== null && running.line === i) inner.push({ line: i, at: running.open, text: inlineText(running) });
        }
        if (inner.length === 0) continue;
        const texts = inner.sort((a, b) => a.line - b.line || a.at - b.at).map(({ text }) => text);
        const labels = held.map(({ name }) => quotedDefinitionLabel(name));
        const entry = byName.get(span.name.toLowerCase());
        if (entry) {
            entry.inner.push(...texts.filter((text) => !entry.inner.includes(text)));
            entry.labels.push(...labels.filter((label) => !entry.labels.includes(label)));
            continue;
        }
        const added = { outer: span.name, inner: [...new Set(texts)], labels: [...new Set(labels)] };
        byName.set(span.name.toLowerCase(), added);
        found.push(added);
    }
    return found;
}


// The nested alert names the footnotes that sit inside a definition and
// the definition they sit in, so the advice says which one to move
// (Jason, 2026-10-22; the singular used to name only the outer definition
// and then say "Move it into the text", meaning the inner one).
//
// A reference or an inline footnote moves into the text. A definition moves
// out of the definition that holds it, which is the only one named in that
// advice (Jason, 2026-11-05). With both kinds nested, each kind gets its own
// sentence, so "them" never covers two different moves.
function noticeNestedFootnotes(lines: string[]) {
    const nested = nestedFootnotes(lines);
    if (nested.length === 0) return;
    const inner = [...new Set(nested.flatMap((entry) => entry.inner))];
    const outer = nested.map((entry) => quotedReference(entry.outer));
    const labels = new Set(nested.flatMap((entry) => entry.labels));
    const others = inner.filter((item) => !labels.has(item));
    const holders = nested.filter((entry) => entry.labels.length > 0).map((entry) => quotedReference(entry.outer));
    const one = inner.length === 1;
    // "them" only when one sentence of advice covers everything named
    const named = (items: readonly string[]) => (items.length === 1 || items.length < inner.length ? andList(items) : "them");
    const advice = [
        ...(others.length > 0 ? [moveIntoText(named(others))] : []),
        ...(labels.size > 0 ? [moveOutOfDefinition(named([...labels]), holders)] : []),
    ];
    showNotice(
        `${andList(inner)} ${one ? "sits" : "sit"} inside the ${outer.length === 1 ? "definition" : "definitions"} of ${andList(outer)}. ` +
            `Nested footnotes don't survive export and most tools can't read them. ${advice.join(" ")}`,
        8000,
    );
}

// Every way of starting a lint calls this with the text as it stands AFTER
// the lint, so the alerts speak whether or not any rule changed anything.
//
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

/**
 * The names of definitions that sit INSIDE a table: a table row directly
 * above the label and another directly below it (labelInsideTable).
 * Obsidian ends the table at the label and folds the rows after it into
 * the footnote's text as a lazy continuation, so the table is broken
 * either way. The plugin does not move the label; it tells the user
 * (Jason's ruling A2, 2026-09-15).
 */
export function definitionsInsideTableNames(markdown: string): string[] {
    const lines = normalizeEol(markdown).text.split("\n");
    const reading = readNote(lines);
    const names: string[] = [];
    const seen = new Set<string>();
    for (let i = 1; i + 1 < lines.length; i++) {
        const label = reading.labelOn(i);
        if (!label || !labelInsideTable(reading, i)) continue;
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
    const left = noticeOrphanedReferences(plugin, markdown, prefix, { lines }, afterLint);
    // the labels the two alerts below leave to the one after them
    const both = underlinedLazyLabelNames(lines);
    const bothFolded = new Set(both.map((name) => name.toLowerCase()));
    noticeLazyDefinitions(lines, bothFolded);
    noticeUnderlinedDefinitions(lines, bothFolded);
    noticeUnderlinedLazyDefinitions(both);
    noticeCommentedDefinitions(markdown);
    noticeDefinitionsInsideTables(markdown);
    const told = noticeOrphanedDefinitions(plugin, markdown, { lines }, afterLint);
    noticeSectionHeadingNotAdded(plugin, markdown);
    left.push(...ungatheredDefinitions(plugin, markdown));
    left.push(...heldChanges(plugin, markdown, afterLint));
    told.push(...noticeDuplicateDefinitions(plugin, markdown, { lines }, afterLint));
    noticeHeldBack(left, new Set(told));
    noticeNestedFootnotes(lines);
    noticeInvalidNames(lines);
}
