import {
    definitionLabelWithName,
    referenceOccurrences,
} from "../../parsing/footnote-grammar";
import { LineEdit, linesReadAlike, readNote } from "../../parsing/note-reading";
import {
    lazyDefinitionLabelLines,
    underlinedDefinitionLabelLines,
    normalizeEol,
    restoreEol,
} from "../../parsing/markdown-scan";
import { FootnoteRule } from "../rule";

// Orphaned REFERENCES: the other side of reindex's orphaned definitions
// (requested 2026-08-10).
//
// A "[^5]" with no "[^5]:" line anywhere in the note renders as plain text
// in Obsidian, not as a footnote. So the lint either reports them, which is
// what it does by default, or, with the "Orphaned references" setting on
// Delete, takes them out of the text.
//
// Three kinds of reference are left alone either way:
//
//  - Names are compared without regard to case, so a definition written
//    with different capitals still counts as that reference's definition.
//  - A name Obsidian will not accept, one with a space or a backtick in it,
//    is not a footnote there either. Deleting "[^my note]" would destroy
//    ordinary prose, so those stay. The creation path already warns about
//    such names.
//  - The note's own bare-prefix placeholder, "[^2.]" in a note whose prefix
//    is "2.", is a footnote the user is in the middle of naming. The
//    unnamed-reference alert speaks for it. Deleting it from under the
//    user's caret would be losing their work.

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
 * Obsidian, as definitionStartLines decides; it is one blank line short of
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
export function underlinedDefinitionLabelNames(lines: string[], ..._unused: unknown[]): string[] {
    const reading = readNote(lines);
    const names: string[] = [];
    const seen = new Set<string>();
    for (const i of underlinedDefinitionLabelLines(lines)) {
        const hit = definitionLabelWithName(lines[i], reading.maskedLine(i));
        if (!hit) continue;
        const folded = hit.name.toLowerCase();
        if (seen.has(folded)) continue;
        seen.add(folded);
        names.push(hit.name);
    }
    return names;
}

export function lazyDefinitionLabelNames(lines: string[], ..._unused: unknown[]): string[] {
    const reading = readNote(lines);
    const names: string[] = [];
    const seen = new Set<string>();
    for (const i of lazyDefinitionLabelLines(lines)) {
        const hit = definitionLabelWithName(lines[i], reading.maskedLine(i));
        if (!hit) continue;
        const folded = hit.name.toLowerCase();
        if (seen.has(folded)) continue;
        seen.add(folded);
        names.push(hit.name);
    }
    return names;
}

/**
 * True when this reference is an orphaned reference the setting should act
 * on.
 */
function isOrphan(
    name: string,
    definitions: Set<string>,
    lazyLabels: Set<string>,
    orphanSafeFolded: string,
): boolean {
    const folded = name.toLowerCase();
    if (definitions.has(folded)) return false;
    if (lazyLabels.has(folded)) return false;
    // a name holding whitespace is prose to Obsidian ("[^my note]" renders
    // as text), so deleting it would destroy ordinary writing. A name
    // holding a backtick is refused for CREATION but renders as a footnote
    // (probed in Reading view 2026-09-16), so an orphaned one is an orphan
    // like any other; exempting it let reindex rename it into a plain
    // orphan that the next lint then ate, so lint twice was not lint once
    // (Kimi hunt cycle 2)
    if (/\s/.test(name)) return false;
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
    const masked = reading.maskedLines();
    const starts = reading.labelLines;
    const definitions = definitionNamesFolded(lines);
    const lazyLabels = new Set([
        ...lazyDefinitionLabelNames(lines).map((n) => n.toLowerCase()),
        // and an underlined label, one blank line short in the other direction
        ...underlinedDefinitionLabelNames(lines).map((n) => n.toLowerCase()),
    ]);
    const orphanSafeFolded = orphanSafePrefix.toLowerCase();

    const names: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < masked.length; i++) {
        for (const { name } of referenceOccurrences(lines[i], masked[i], starts[i])) {
            if (!isOrphan(name, definitions, lazyLabels, orphanSafeFolded)) continue;
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
export function removeOrphanedFootnoteReferences(
    markdown: string,
    orphanSafePrefix = "",
): string {
    const { text, eol } = normalizeEol(markdown);
    const lines = text.split("\n");
    const reading = readNote(lines);
    const masked = reading.maskedLines();
    const starts = reading.labelLines;
    const definitions = definitionNamesFolded(lines);
    const lazyLabels = new Set([
        ...lazyDefinitionLabelNames(lines).map((n) => n.toLowerCase()),
        // and an underlined label, one blank line short in the other direction
        ...underlinedDefinitionLabelNames(lines).map((n) => n.toLowerCase()),
    ]);
    const orphanSafeFolded = orphanSafePrefix.toLowerCase();

    // the orphans on each line, rightmost first so that cutting one keeps
    // the offsets of the ones before it
    const orphansOn = (i: number): { start: number; end: number }[] =>
        reading.protectedLines[i]
            ? []
            : referenceOccurrences(lines[i], masked[i], starts[i])
                  .filter(({ name }) => isOrphan(name, definitions, lazyLabels, orphanSafeFolded))
                  .map(({ start, end }) => ({ start, end }))
                  .reverse();
    if (!lines.some((_, i) => orphansOn(i).length > 0)) return markdown;

    // A cut that changes how Obsidian reads ANY line is refused, and the
    // orphan stays for the user to sort out (readsDifferently says why).
    //
    // Each orphaned NAME is judged on its own, all of its references
    // together: one refused cut used to veto every safe one in the note
    // (Kimi hunt cycle 4), and a name half deleted would confuse the alert
    // that speaks in names. The whole set is tried first, since that is
    // the common case and costs one scan.
    const all = lines.map((line, i) => orphansOn(i).reduce((text, { start, end }) => cutOne(text, start, end), line));
    if (!readsDifferently(lines, all)) return restoreEol(all.join("\n"), eol);

    const orphanNames: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (reading.protectedLines[i]) continue;
        for (const { name } of referenceOccurrences(lines[i], masked[i], starts[i])) {
            const folded = name.toLowerCase();
            if (isOrphan(name, definitions, lazyLabels, orphanSafeFolded) && !orphanNames.includes(folded)) {
                orphanNames.push(folded);
            }
        }
    }
    let current = lines;
    for (const folded of orphanNames) {
        const now = readNote(current);
        const trial = current.map((line, i) => {
            if (now.protectedLines[i]) return line;
            return referenceOccurrences(line, now.maskedLine(i), now.labelLines[i])
                .filter(({ name }) => name.toLowerCase() === folded)
                .reverse()
                .reduce((text, { start, end }) => cutOne(text, start, end), line);
        });
        if (trial.every((line, i) => line === current[i])) continue;
        if (readsDifferently(current, trial)) continue;
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
 * Shared with the Delete footnote command, which cuts references the same
 * way (T4, 2026-09-21).
 */
export function cutOne(line: string, start: number, end: number): string {
    const head = line.slice(0, start);
    let copied = end;
    if (line[copied] === " " && (head === "" || head.endsWith(" "))) copied++;
    const tail = line.slice(copied);
    return tail === "" ? head.replace(/[ \t]+$/, "") : head + tail;
}

/**
 * Whether an edit that keeps every line where it was (`before` and
 * `after` have the same length) changed how Obsidian reads any line of
 * the note: a line the edit did not touch must read exactly as it did,
 * and a line it touched may only lose things (linesReadAlike in
 * note-reading.ts says what that means). `touched` says how the edited
 * lines changed: "cut" when text was only taken out of them (an orphaned
 * reference, a deleted footnote's references), "rewrite" when it was
 * replaced (a reference turned into an inline footnote).
 *
 * Deleting reference text can change how Obsidian reads a line far away.
 * Emptying the paragraph between a definition and an indented block turns
 * that block from indented CODE into a continuation line of the
 * definition, because Obsidian carries a definition on across any number
 * of blank lines. (Verified against metadataCache, 2026-08-10; found by
 * the idempotence property.) Emptying the line above a lazy label would
 * turn that label into a real definition (second review, 2026-09-09). A
 * leftover marker can turn a line into a block of another kind: "#[^9]
 * tail" is prose and "# tail" a heading, "[^9]> q" prose and "> q" a
 * quote (Kimi hunt cycle 4, 2026-09-16; hunt 2026-10-02, cluster E11). An
 * emptied line can split a paragraph in two, or leave a "-" that makes the
 * line above a heading (clusters D3, D4); and the text left behind can
 * become a link or another reference ("[Smith](2020)", "[^2]"; clusters
 * D8, D9). Comparing the note reading of the two texts line by line
 * catches all of these the same way (the runtime swap, step 2,
 * 2026-10-03).
 *
 * Shared with the Delete footnote command (T4, 2026-09-21) and the
 * conversions.
 */
export function readsDifferently(before: string[], after: string[], touched: LineEdit = "cut"): boolean {
    const readingBefore = readNote(before);
    const readingAfter = readNote(after);
    for (let i = 0; i < before.length; i++) {
        if (!linesReadAlike(readingBefore, i, readingAfter, i, before[i] === after[i] ? "none" : touched)) return true;
    }
    return false;
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
