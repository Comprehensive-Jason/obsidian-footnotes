import { referenceText } from "../parsing/footnote-grammar";
import { NoteReading } from "../parsing/note-reading";

/**
 * Line `i` of the note `reading` read, `line`, with every live reference
 * renamed, and every definition label on it too. `resolve` picks the new
 * name for each old one; returning null means leave that name alone.
 *
 * This is the single renaming walk that the apply-prefix and reindex rules
 * each used to carry their own copy of (duplicated-logic audit,
 * 2026-09-05).
 *
 * How it works. The reading says where each live reference and each label
 * sits (the runtime swap, step 3, 2026-10-03), and each is cut into the
 * line by its position, so reference-shaped text inside a code span, an
 * inline footnote, or a link's label is left alone, and so is a name
 * holding a space, which Obsidian reads as plain text. A label "[^name]:"
 * is renamed by the same cut as a reference, since only the name between
 * "[^" and "]" changes, whether it sits at the left margin, behind a quote
 * marker, or after a list marker (Jason's ruling 1, option a, 2026-10-03).
 */
export function rewriteFootnoteNames(reading: NoteReading, i: number, line: string, resolve: (name: string) => string | null): string {
    let result = "";
    let copied = 0;
    const occurrences = [...reading.labelsOn(i), ...reading.referencesOn(i)].sort((a, b) => a.start - b.start);
    for (const { name, start, end } of occurrences) {
        const newName = resolve(name);
        if (newName === null) continue;
        result += line.slice(copied, start) + referenceText(newName);
        copied = end;
    }
    return result + line.slice(copied);
}
