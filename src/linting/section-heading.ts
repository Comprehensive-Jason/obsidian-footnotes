import { findLineRunEnd } from "../parsing/line-edits";
import type { NoteReading } from "../parsing/note-reading";

/** A line without the spaces and tabs at its end. */
function withoutTrailingWhitespace(line: string): string {
    return line.replace(/[ \t]+$/, "");
}

/**
 * Where the section heading ends in the note, as the index of its last line,
 * or -1 when the note does not have it. `heading` is the setting's text, which
 * may run over several lines, and `reading` is the reading of `lines`.
 *
 * Spaces and tabs at the end of a line do not count, on the note's line or in
 * the setting. They are invisible in the editor, and "# Footnotes " used to get
 * a second "# Footnotes" under it (Jason's ruling, 2026-11-05; pin
 * spec-lint-section-heading-line-variants).
 *
 * This is the one way the plugin finds the heading. Creating a footnote, the
 * move to the bottom, and removing an empty heading all ask here, because if
 * they disagreed, running the lint again would keep changing the note.
 */
export function findSectionHeadingEnd(lines: readonly string[], reading: NoteReading, heading: string): number {
    return findLineRunEnd(
        lines.map(withoutTrailingWhitespace),
        reading.protectedLines,
        heading.split("\n").map(withoutTrailingWhitespace),
        reading.commentLines,
    );
}
