import { rulePasses } from "../rule-gate";
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
 * With no heading configured, or none in the note, nothing changes, and
 * nor does it when the result gate refuses taking the heading out
 * (rule-gate.ts).
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
    const headingStart = end - headingLines.length + 1;
    let start = headingStart;
    while (start > 0 && lines[start - 1].trim() === "") start--;
    const out = lines.slice(0, start);
    // The heading is the settings' text, and the tidy means to take it out,
    // so the gate is told so (removedText): a heading holding a comment,
    // inline code, or HTML ("%% footnotes %%", "## `Notes`") is then not
    // taken for protected text the tidy changed (found while fixing hunt
    // 2026-10-08, cycle 6, cluster Z9, the same cause in reverse).
    const heading = { from: { line: headingStart, ch: 0 }, to: { line: end, ch: lines[end].length } };
    return rulePasses(lines, out, { removedText: [heading] }) ? restoreEol(out.join("\n"), eol) : markdown;
}
