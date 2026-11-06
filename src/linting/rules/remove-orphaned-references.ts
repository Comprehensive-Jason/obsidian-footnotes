import { rulePasses } from "../rule-gate";
import { readNote } from "../../parsing/note-reading";
import { definitionLabelWithName, labelShapedLines } from "../../parsing/label-shapes";
import { spacesGoWithFootnoteBefore, wordEndBefore } from "../../parsing/landing";
import { normalizeEol, restoreEol } from "../../parsing/line-edits";
import { FootnoteRule } from "../rule";

// Orphaned REFERENCES: the other side of reindex's orphaned definitions
// (requested 2026-08-10).
//
// A "[^5]" with no "[^5]:" line anywhere in the note renders as plain text
// in Obsidian, not as a footnote. So the lint either reports them, which is
// what it does by default, or, with the "Orphaned references" setting on
// Delete, takes them out of the text.
//
// Five kinds of reference are left alone either way:
//
//  - Names are compared without regard to case, so a definition written
//    with different capitals still counts as that reference's definition.
//  - A name holding a space is no footnote to Obsidian: "[^my note]" is
//    ordinary prose, and the note reading holds no reference there, so it
//    is never deleted (the lint's invalid-name alert speaks for it). A name
//    holding a backtick is refused for creation but renders as a footnote
//    (probed in Reading view 2026-09-16), so an orphaned one is an orphan
//    like any other (Kimi hunt cycle 2).
//  - The note's own bare-prefix placeholder, "[^2.]" in a note whose prefix
//    is "2.", is a footnote the user is in the middle of naming. The
//    unnamed-reference alert speaks for it. Deleting it from under the
//    user's caret would be losing their work.
//  - A reference whose definition the user wrote where Obsidian does not
//    read it as one, as a lazy label, an underlined label, or a label hidden
//    in a "%%" comment (Jason's ruling on the comment, 2026-11-05; pin
//    spec-lint-orphan-cut-commented-label). The user wrote the definition,
//    so deleting the reference would throw that work away. The label's own
//    "[^x]" counts as a reference too, and cutting it would leave ": text"
//    behind. Each of these has an alert saying how to fix it.
//  - A name ending in a backslash, as the note reading finds in "[^a\]b]".
//    The backslash escapes the "]", so the live check on Obsidian 1.15.0
//    (2026-11-05) reads that as plain text and no footnote, while the note
//    reading stops the name at the "]". Cutting it would cut prose apart, and
//    leave "b]" behind (pin spec-escaped-bracket-in-label).

/**
 * Every name the note defines, lower-cased, wherever the definition sits:
 * at the left margin, inside a blockquote or callout (C22), or in a list
 * item (Jason's ruling 1, 2026-09-20, and option a, 2026-10-03).
 */
function definitionNamesFolded(lines: string[]): Set<string> {
    return new Set(readNote(lines).definitions.map((definition) => definition.name.toLowerCase()));
}

/**
 * The names on lines that look like labels but are NOT definitions. A
 * "[^x]:" line directly under a line of prose is more paragraph text to
 * Obsidian, as the note reading decides; it is one blank line short of
 * the definition the user meant. The project calls it a lazy label.
 *
 * The names come back in the order they first appear, spelled as first
 * seen, with protected lines skipped.
 *
 * This is exported for the lint alert that lists them. Here it matters for a
 * different reason: a reference pointing at a lazy label is not an orphan to
 * delete. The fix is a blank line, and deleting the reference would throw
 * the user's work away (2026-09-09).
 */
/**
 * The names of labels that a setext underline sits directly under: heading
 * text to Obsidian, or plain text inside a longer paragraph, and one blank
 * line (between the label and the underline) short of a definition. Like
 * the lazy labels above, a reference pointing at one is not an orphan to
 * delete: the user wrote the definition (Kimi hunt cycle 3, probed in
 * Reading view 2026-09-16).
 */
export function underlinedDefinitionLabelNames(lines: string[]): string[] {
    return labelNames(lines, true);
}

export function lazyDefinitionLabelNames(lines: string[]): string[] {
    return labelNames(lines, false);
}

/**
 * The names of the lazy labels (`underlined` false) or the underlined ones
 * (true), each once, in order. The names come from labelShapedLines, which
 * reads each label from where its line's list and quote markers end. They
 * used to be read again from the line's margin, which found no label at
 * the content column of a nested or wide list item ("    [^b]: lazy"), so
 * the alert asked for a definition the user had written and Delete
 * orphaned references cut both "[^b]" (hunt 2026-10-05, pins
 * bug-lazy-label-wide-item-content-column and
 * spec-lazy-label-wide-item-alert).
 */
function labelNames(lines: string[], underlined: boolean): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const label of labelShapedLines(lines)) {
        if (label.underlined !== underlined) continue;
        const folded = label.name.toLowerCase();
        if (seen.has(folded)) continue;
        seen.add(folded);
        names.push(label.name);
    }
    return names;
}

/**
 * The names of definitions written inside a "%%" block comment, in order,
 * each once. Obsidian never shows a definition there (its reference half
 * still counts, so the footnote may render from a real definition
 * elsewhere, or not at all), and the user almost certainly meant it to be
 * seen, so the lint names it (Jason's ruling A1, 2026-09-15).
 */
export function commentedDefinitionNames(markdown: string): string[] {
    return commentedLabelNames(normalizeEol(markdown).text.split("\n"));
}

/** The names commentedDefinitionNames gives, for a note already split into lines. */
function commentedLabelNames(lines: string[]): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const { name } of commentedLabelLines(lines)) {
        const folded = name.toLowerCase();
        if (seen.has(folded)) continue;
        seen.add(folded);
        names.push(name);
    }
    return names;
}

/** Every definition label inside a "%%" block comment, in order: its line and its name as written. */
export function commentedLabelLines(lines: string[]): { line: number; name: string }[] {
    const reading = readNote(lines);
    const labels: { line: number; name: string }[] = [];
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
        labels.push({ line: i, name: hit.name });
    }
    return labels;
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

/**
 * Every name, lower-cased, of a label the user wrote where Obsidian does not
 * read it as a definition: lazy, underlined, or inside a "%%" comment. A
 * reference to one of these is not an orphan to delete.
 */
function misplacedLabelNamesFolded(lines: string[]): Set<string> {
    return new Set(
        [...lazyDefinitionLabelNames(lines), ...underlinedDefinitionLabelNames(lines), ...commentedLabelNames(lines)].map((name) => name.toLowerCase()),
    );
}

/**
 * True when this reference is an orphaned reference the setting should act
 * on.
 */
function isOrphan(
    name: string,
    definitions: Set<string>,
    misplacedLabels: Set<string>,
    orphanSafeFolded: string,
): boolean {
    const folded = name.toLowerCase();
    if (name.endsWith("\\")) return false;
    if (definitions.has(folded)) return false;
    if (misplacedLabels.has(folded)) return false;
    if (orphanSafeFolded !== "" && folded === orphanSafeFolded) return false;
    return true;
}

/**
 * The list the alert reads out: the names of orphaned references, each once,
 * in the order they first appear, spelled as first seen.
 *
 * `orphanSafePrefix` is the note's own footnote-prefix, when the prefix
 * feature is on and the prefix is valid. It is "" otherwise.
 */
export function orphanedFootnoteReferenceNames(
    markdown: string,
    orphanSafePrefix = "",
    // The alerts share the note's lines, split once (2026-08-11 review, a
    // speed fix); the reading is remembered per text. Anything calling this
    // on its own leaves it out.
    precomputed?: { lines: string[] },
): string[] {
    // No "[^" anywhere in the note means no references, and so no orphaned
    // ones. Worth checking first, because this runs on every single lint
    // (speed fix F4).
    if (!markdown.includes("[^")) return [];
    const lines = precomputed?.lines ?? normalizeEol(markdown).text.split("\n");
    const reading = readNote(lines);
    const definitions = definitionNamesFolded(lines);
    const misplacedLabels = misplacedLabelNamesFolded(lines);
    const orphanSafeFolded = orphanSafePrefix.toLowerCase();

    const names: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
        for (const { name } of reading.referencesOn(i)) {
            if (!isOrphan(name, definitions, misplacedLabels, orphanSafeFolded)) continue;
            const folded = name.toLowerCase();
            if (!seen.has(folded)) {
                seen.add(folded);
                names.push(name);
            }
        }
    }
    return names;
}

/**
 * `markdown` with every orphaned reference taken out of the text.
 * Definitions, protected text and the three exceptions listed at the top of
 * this file are left alone.
 *
 * The spacing closes up neatly: "a [^1] b" becomes "a b", and a reference
 * that was the last thing on its line takes the space in front of it with
 * it. Spaces the line already ended with stay, because two of them at the
 * end of a line are a markdown line break the user typed on purpose.
 */
export function removeOrphanedFootnoteReferences(markdown: string, orphanSafePrefix = ""): string {
    const { text, eol } = normalizeEol(markdown);
    const lines = text.split("\n");
    const reading = readNote(lines);
    const definitions = definitionNamesFolded(lines);
    const misplacedLabels = misplacedLabelNamesFolded(lines);
    const orphanSafeFolded = orphanSafePrefix.toLowerCase();

    // the orphans on each line, rightmost first so that cutting one keeps
    // the offsets of the ones before it
    const orphansOn = (i: number): { start: number; end: number }[] =>
        reading
            .referencesOn(i)
            .filter(({ name }) => isOrphan(name, definitions, misplacedLabels, orphanSafeFolded))
            .map(({ start, end }) => ({ start, end }))
            .reverse();
    if (!lines.some((_, i) => orphansOn(i).length > 0)) return markdown;

    // The result gate judges the cuts (rule-gate.ts), and one it refuses,
    // one that changes how Obsidian reads any line but by losing the
    // reference, is not made, and the orphan stays for the user to sort
    // out. Deleting reference text can change how Obsidian reads a line far
    // away: emptying the paragraph between a definition and an indented
    // block turns that block from indented CODE into a continuation line of
    // the definition, because Obsidian carries a definition on across any
    // number of blank lines (verified against metadataCache, 2026-08-10;
    // found by the idempotence property). Emptying the line above a lazy
    // label would turn that label into a real definition (second review,
    // 2026-09-09). A leftover marker can turn a line into a block of
    // another kind: "#[^9] tail" is prose and "# tail" a heading (Kimi hunt
    // cycle 4, 2026-09-16; hunt 2026-10-02, cluster E11). And cutting "[^9]"
    // out of "[^8][^9]: x" under a line of prose leaves "[^8]: x", which
    // reads the same, but the next lint's fix for lazy labels would make it
    // a second definition of footnote 8 (hunt 2026-10-02, cluster P4).
    //
    // Each orphaned NAME is judged on its own, all of its references
    // together: one refused cut used to veto every safe one in the note
    // (Kimi hunt cycle 4), and a name half deleted would confuse the alert
    // that speaks in names. The whole set is tried first, since that is
    // the common case and costs one judgment.
    const all = lines.map((line, i) => orphansOn(i).reduce((text, { start, end }) => cutOne(text, start, end, reading.blockSyntaxEnd(i)), line));
    const orphanNames: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const { name } of reading.referencesOn(i)) {
            const folded = name.toLowerCase();
            if (isOrphan(name, definitions, misplacedLabels, orphanSafeFolded) && !orphanNames.includes(folded)) {
                orphanNames.push(folded);
            }
        }
    }
    if (rulePasses(lines, all, { removed: orphanNames })) return restoreEol(all.join("\n"), eol);

    let current = lines;
    for (const folded of orphanNames) {
        const now = readNote(current);
        const trial = current.map((line, i) =>
            now
                .referencesOn(i)
                .filter(({ name }) => name.toLowerCase() === folded)
                .reverse()
                .reduce((text, { start, end }) => cutOne(text, start, end, now.blockSyntaxEnd(i)), line),
        );
        if (trial.every((line, i) => line === current[i])) continue;
        if (!rulePasses(current, trial, { removed: [folded] })) continue;
        current = trial;
    }
    if (current === lines) return markdown;
    return restoreEol(current.join("\n"), eol);
}

/**
 * One reference's cut out of its line, with the gap closed the way the
 * user would close it: a space just after the cut goes when the text
 * before the cut already ends in a space or the cut was at the line's very
 * start, and a reference that ended the line takes the space in front of
 * it. Spaces the line already ended with stay, because two of them at the
 * end of a line are a markdown line break the user typed on purpose.
 *
 * A reference that punctuation follows takes the spaces typed in front of
 * it too, since they belong to it: "word [^1]." becomes "word.", not
 * "word ." (Jason's ruling Q35, 2026-10-09, which settles D10; pin
 * spec-delete-stray-space-before-punctuation), and "word, [^1]." becomes
 * "word,." (the same ruling applied after punctuation). The same goes for a
 * closing bracket or quote: "(see [^1])" becomes "(see)" (hunt 2026-11-06,
 * cycle 9, finding H32, the triage's choice extending that ruling). `textStart`
 * is the column where the line's text begins (NoteReading.blockSyntaxEnd), so
 * the space after "- " or "> " stays (wordEndBefore).
 *
 * Shared with the Delete footnote command, which cuts references the same
 * way (T4, 2026-09-21).
 */
export function cutOne(line: string, start: number, end: number, textStart = 0): string {
    const head = line.slice(0, spacesGoWithFootnoteBefore(line, end) ? wordEndBefore(line, start, textStart) : start);
    let copied = end;
    if (line[copied] === " " && (head === "" || head.endsWith(" "))) copied++;
    const tail = line.slice(copied);
    return tail === "" ? head.replace(/[ \t]+$/, "") : head + tail;
}

/**
 * This rule's catalogue entry. The option is the note's own prefix, whose
 * bare placeholder must not be deleted.
 */
export const removeOrphanedReferencesRule: FootnoteRule<{ orphanSafePrefix?: string }> =
    {
        id: "remove-orphaned-references",
        name: "Remove orphaned references",
        description:
            "Delete footnote references that have no definition anywhere in the note.",
        examples: [
            {
                description: "A reference with no definition is removed",
                before: "keep[^1] drop[^9] end\n\n[^1]: one",
                after: "keep[^1] drop end\n\n[^1]: one",
                options: {},
            },
            {
                description: "A definition in any casing keeps its references",
                before: "see[^Note]\n\n[^note]: n",
                after: "see[^Note]\n\n[^note]: n",
                options: {},
            },
        ],
        apply: (text, options) =>
            removeOrphanedFootnoteReferences(text, options.orphanSafePrefix ?? ""),
    };
