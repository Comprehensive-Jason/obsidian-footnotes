import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (refused): a selection of whole lines that starts with a block other
// than prose (a code fence, a "$$" math block, a heading) and ends on the
// first line of a paragraph, with more of that paragraph under it, was
// refused with "it would break the line's formatting". The same cut that
// starts with prose converts, and so does one that takes the whole
// paragraph. The paragraph's first line is a whole line to the user, since
// nothing in the editor shows that the line under it is the same paragraph.
//
// What the user sees now: the selection becomes a footnote, and the rest of
// the paragraph stays where it was, under the reference, as when a prose
// selection cuts a paragraph after its first line.
//
// Jason, sheet 5 ("Fenced code and $$ math"), 2026-11-06: the fence through
// the inline math line, with the prose lines outside. Source of truth: the
// sheet, which expects the footnote to render the code block and the math
// block. Severity: refused. Origin: the result gate's whole-blocks rule
// (Jason's ruling on partial tables, 2026-09-04), which asked the line under
// the selection to start a block.

const FENCE = "```";

function press(lines: string[], fromLine: number, toLine: number) {
    const doc = fakeEditor(lines, {
        wholeDoc: true,
        edits: true,
        cursor: { line: toLine, ch: lines[toLine].length },
        selection: { anchor: { line: fromLine, ch: 0 }, head: { line: toLine, ch: lines[toLine].length } },
    });
    return insertAutonumFootnote(fakePlugin({ enablePopupEditor: false }, doc)).then(() => doc.lines);
}

describe("a selection from a block into a paragraph's first line converts", () => {
    beforeEach(resetNotices);

    it("the fence through the inline math line, with prose around (sheet 5)", async () => {
        const lines = [
            "before the fence",
            FENCE,
            "fenced code here",
            FENCE,
            "$$",
            "E = mc^2",
            "$$",
            "inline math before $1+1\\neq3$ and after",
            "after the fence",
        ];
        expect(await press(lines, 1, 7)).toEqual([
            "before the fence",
            "[^1]",
            "after the fence",
            "",
            "[^1]: ",
            "    " + FENCE,
            "    fenced code here",
            "    " + FENCE,
            "    $$",
            "    E = mc^2",
            "    $$",
            "    inline math before $1+1\\neq3$ and after",
        ]);
        expect(messages()).toEqual([]);
    });

    it("a $$ block through the paragraph's first line", async () => {
        const lines = ["$$", "E = mc^2", "$$", "first line", "second line"];
        expect(await press(lines, 0, 3)).toEqual([
            "[^1]",
            "second line",
            "",
            "[^1]: $$",
            "    E = mc^2",
            "    $$",
            "    first line",
        ]);
        expect(messages()).toEqual([]);
    });

    it("a heading through the paragraph's first line", async () => {
        const lines = ["# Heading", "first line", "second line"];
        expect(await press(lines, 0, 1)).toEqual(["[^1]", "second line", "", "[^1]: # Heading", "    first line"]);
        expect(messages()).toEqual([]);
    });

    // A characterization test: the same cut from a prose start already
    // converted, and is the behaviour the cases above now share.
    it("a paragraph through the next paragraph's first line, as before", async () => {
        const lines = ["x", "", "first line", "second line"];
        expect(await press(lines, 0, 2)).toEqual(["[^1]", "second line", "", "[^1]: x", "    ", "    first line"]);
        expect(messages()).toEqual([]);
    });
});
