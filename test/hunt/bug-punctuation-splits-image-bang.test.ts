import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// BUG (wrong output): a reference written right in front of an image or an
// embed is moved over the image's "!", and the image is gone.
//
// What the user would see: on default settings, "See the chart[^1]
// ![[chart.png]]" (no space between them) is saved, and the lint writes
// "See the chart![^1][[chart.png]]". Reading view now shows a stray "!" and
// a plain link to chart.png where the picture was. The same happens to a
// Markdown image "![chart](chart.png)", which becomes a "!" and a link, to
// a reference image "![x]" with "[x]: pic.png" defined, and to a numbered
// press at the end of "chart" in "See the chart![[chart.png]]".
//
// An "embed" is Obsidian's "![[file]]", which shows the file in the note.
//
// Hunt 2026-10-06, cycle 3, lens lint. Cluster L4.
//
// Origin: pre-existing (cec4352 gives the same output).
//
// Source of truth: CommonMark 6.4 (an image is "!" immediately followed by
// a link; split, it is a "!" and a link) and Obsidian's embed syntax
// "![[file]]"; the punctuation rule's docstring (it moves a reference to
// the other side of punctuation, and steps over link-like text whole);
// round 2's decision that real links and images are stepped over whole.
//
// Cause: the punctuation rule (src/linting/rules/footnote-after-punctuation.ts)
// and the press's landing walk take the "!" that starts an image or an
// embed for an exclamation mark. The born-dead check 104fd32 added does not
// see it, because it counts footnotes per line, and the footnote stays
// live; what dies is the image.

beforeEach(resetNotices);

/** The links of line 0 of `text`, as the note reading sees them: the start column of each. */
function linkStarts(text: string): number[] {
    return readNote(text.split("\n"))
        .links.filter((link) => link.startLine === 0)
        .map((link) => link.start);
}

describe("after: a reference in front of an image is not moved over the image's '!'", () => {
    // Before the fix: "See the chart![^1][[chart.png]]".
    it.fails("an embed ![[chart.png]] stays an embed", () => {
        const out = lintFootnotes("See the chart[^1]![[chart.png]]\n\n[^1]: a");
        expect(out).toContain("![[chart.png]]");
    });

    it.fails("an inline image ![chart](chart.png) stays an image", () => {
        const doc = "See the chart[^1]![chart](chart.png)\n\n[^1]: a";
        const out = lintFootnotes(doc);
        expect(out).toContain("![chart](chart.png)");
        // The reading agrees: the image starts at the "!" (column 17), and
        // the link it reads after the lint starts with that "!" too.
        expect(linkStarts(doc)).toEqual([17]);
        expect(linkStarts(out).map((start) => out[start])).toEqual(["!"]);
    });

    it.fails("a reference image ![x] with [x] defined stays an image", () => {
        const out = lintFootnotes("Wow[^1]![x] more\n\n[^1]: a\n\n[x]: pic.png");
        expect(out.split("\n")[0]).toContain("![x]");
    });

    it.fails("a numbered press at the end of 'chart' keeps the embed", async () => {
        const doc = fakeEditor(["See the chart![[chart.png]]"], { cursor: { line: 0, ch: "See the ch".length }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(
            fakePlugin(
                {
                    insertAtEndOfWord: true,
                    footnotePlacement: "after",
                    enablePopupEditor: false,
                    enableFootnotePrefix: false,
                    enableFootnoteSectionHeading: false,
                    footnoteSectionHeading: "",
                    enableRemoveBlankLastLines: true,
                    lintOnFootnoteCreation: false,
                },
                doc,
            ),
        );
        expect(doc.lines[0]).not.toBe("See the chart![[chart.png]]");
        expect(doc.lines[0]).toContain("![[chart.png]]");
    });
});
