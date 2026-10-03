import { referenceOccurrences, referenceText } from "../parsing/footnote-grammar";

/**
 * Return `line` with every live reference renamed, and its definition's
 * label too when the line holds one. `resolve` picks the new name for each
 * old one; returning null means leave that name alone.
 *
 * This is the single renaming walk that the apply-prefix and reindex rules
 * each used to carry their own copy of (duplicated-logic audit,
 * 2026-09-05).
 *
 * How it works. Every "[^name]" on the line is found against the masked
 * twin (the copy of the line with protected text blanked out) and cut into
 * the line by its position, so a reference-shaped string inside a code span
 * is left alone. A label "[^name]:" is renamed by the same cut as a
 * reference, since only the name between "[^" and "]" changes, whether it
 * sits at the left margin, behind a quote marker, or after a list marker
 * (Jason's ruling 1, option a, 2026-10-03: a definition in a list item is
 * renamed like any other). So the walk does not need to know whether the
 * line holds a label at all.
 *
 * `masked` is this line's masked twin, worked out with the whole note in
 * view.
 */
export function rewriteFootnoteNames(line: string, masked: string, resolve: (name: string) => string | null): string {
    let result = "";
    let copied = 0;
    for (const { name, start, end } of referenceOccurrences(line, masked, false)) {
        // a name holding whitespace is prose to Obsidian, not a footnote,
        // so it is never renamed into one (Claude sweep 2026-09-13)
        if (/\s/.test(name)) continue;
        const newName = resolve(name);
        if (newName === null) continue;
        result += line.slice(copied, start) + referenceText(newName);
        copied = end;
    }
    return result + line.slice(copied);
}
