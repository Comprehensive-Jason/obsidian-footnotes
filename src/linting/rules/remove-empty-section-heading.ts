import { findLineRunEnd, normalizeEol, restoreEol } from "../../parsing/line-edits";
import { readNote } from "../../parsing/note-reading";

// Jason's ask, 2026-09-25: when a plugin action leaves nothing under the
// footnote section heading, the heading goes too, if the "Remove empty
// section heading" setting is on. It is off by default, because a
// template can carry a References heading that should stay even while
// empty; people who write fast turn it on. The rule is applied in three
// places, after the normal-to-inline conversion, after Delete footnote
// everywhere, and at the end of a lint, so every way of emptying the
// section behaves the same.

/**
 * `markdown` with its footnote section heading removed when the section
 * is empty: the heading (the configured run of lines, found the one way
 * the plugin finds it, findLineRunEnd) is followed by nothing but blank
 * lines to the end of the note. The blank lines above the heading go with
 * it, so the note ends on its last line of text. A heading that prose,
 * a definition, or another heading follows is not an empty footnote
 * section and is left alone, as is a look-alike inside code or a comment.
 * With no heading configured, or none in the note, nothing changes.
 */
export function removeEmptySectionHeading(markdown: string, sectionHeading: string): string {
    if (sectionHeading === "") return markdown;
    const { text, eol } = normalizeEol(markdown);
    const lines = text.split("\n");
    const reading = readNote(lines);
    const headingLines = sectionHeading.split("\n");
    const end = findLineRunEnd(lines, reading.protectedLines, headingLines, reading.commentLines);
    if (end === -1) return markdown;
    for (let i = end + 1; i < lines.length; i++) {
        if (lines[i].trim() !== "") return markdown;
    }
    let start = end - headingLines.length + 1;
    while (start > 0 && lines[start - 1].trim() === "") start--;
    return restoreEol(lines.slice(0, start).join("\n"), eol);
}
