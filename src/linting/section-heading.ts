import { findLineRunEnd } from "../parsing/line-edits";
import { readNote } from "../parsing/note-reading";
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
 * A copy of the text counts only where the note reads it as the same blocks the
 * setting's text makes on its own. A "---" under a line of text is that line's
 * underline, part of its heading, and no divider: taken for the section heading,
 * it left the note stuck, with no divider and nothing said (hunt 2026-11-06,
 * cycle 9, H15; pin spec-section-heading-divider-setext-underline). The setting's
 * text is read below a blank line, so a run of "---" lines is not taken for
 * frontmatter, which only the first line of a note can open.
 *
 * This is the one way the plugin finds the heading. Creating a footnote, the
 * move to the bottom, and removing an empty heading all ask here, because if
 * they disagreed, running the lint again would keep changing the note.
 */
export function findSectionHeadingEnd(lines: readonly string[], reading: NoteReading, heading: string): number {
    const trimmed = lines.map(withoutTrailingWhitespace);
    const run = heading.split("\n").map(withoutTrailingWhitespace);
    // the lines the search may not start on or run over, which grow by each
    // copy of the text that reads as something else
    const ruledOut = [...reading.protectedLines];
    let blocks: readonly string[] | undefined;
    for (;;) {
        const end = findLineRunEnd(trimmed, ruledOut, run, reading.commentLines);
        if (end === -1) return -1;
        const start = end - run.length + 1;
        blocks ??= readNote(["", ...run]).lineBlocks.slice(1);
        if (run.every((_, k) => reading.lineBlocks[start + k] === blocks?.[k])) return end;
        ruledOut[start] = true;
    }
}
