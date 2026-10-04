import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { BlockSyntaxNotice } from "../../src/editor/notice";
import { readNote } from "../../src/parsing/note-reading";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";

// BUG (wrong output): rulings 4 and 5 refuse a press in front of a quote
// marker and on a setext underline, but not when the quote sits inside a
// list item. There the press writes into the quote's syntax.
//
// What the user would see: a list item holds a quote, "- > quoted in a
// list item". With the caret right in front of the ">" (ch 2), the press
// writes the reference there, and the line becomes "- [^1]> quoted in a
// list item": a list item holding plain text, no longer a quote. The same
// happens in an ordered item ("1. > ...") and in a nested item
// ("  - > deeper"). And in "- > Setext" over "  > ===", the second line
// is a setext underline that makes the first a heading inside the quote;
// a press on it writes into the underline, and the heading turns back into
// prose.
//
// Hunt 2026-10-02, round 3, lens reg. Cluster E4.
//
// Source of truth: Jason's rulings 4 and 5 (2026-09-20, commit f098798;
// test/press-guards-quote-and-underline.test.ts states the harm), and
// CommonMark: "- > q" is a blockquote inside a list item, and "- > Setext"
// over "  > ===" is a level-1 heading inside that quote (a one-line
// paragraph, so Obsidian's one-line setext rule of 94f830b applies too).
//
// Cause: the guard in src/commands/press-guards.ts read the quote markers
// with /^(\s*>)+/ at the very start of the line, so a ">" behind a list
// marker was never seen, and the scan's setextUnderline flag was not set
// for an underline inside a quote inside a list item.
//
// Fixed 2026-10-03 with Jason's block-syntax ruling: the press refuses
// whenever the caret sits in the block syntax the note reading finds at
// the start of its line, whatever the containers, with the notice of that
// ruling (BlockSyntaxNotice).
//
// (The caret at ch 0 of "- > quoted", in front of the LIST marker, is
// spec-press-caret-inside-block-syntax, ruled the same day.)

// The settings around the press: insert at end of word on, everything
// else that could move text afterwards off.
const settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

/** Press the numbered key with the caret at line, ch of `lines`, and hand back the editor. */
async function press(lines: string[], line: number, ch: number) {
    const doc = fakeEditor([...lines], { cursor: { line, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(settings, doc));
    return doc;
}

describe("ruling 4 one container deeper: a quote marker behind a list marker", () => {
    beforeEach(resetNotices);

    for (const [lines, ch] of [
        [["- > quoted in a list item"], 2],
        [["1. > quoted in an ordered item"], 3],
        [["- item", "", "  - > deeper"], 4],
    ] as [string[], number][]) {
        it(`refuses with the caret at ch ${ch} of ${JSON.stringify(lines[lines.length - 1])}`, async () => {
            const doc = await press(lines, lines.length - 1, ch);
            // Before the fix: the reference was written in front of the ">", as in
            // "- [^1]> quoted in a list item".
            expect(doc.lines).toEqual(lines);
            expect(noticed(BlockSyntaxNotice)).toBe(true);
        });
    }

    it("control: in front of a quote marker at the line start it refuses already", async () => {
        const lines = ["> quoted"];
        const doc = await press(lines, 0, 0);
        expect(doc.lines).toEqual(lines);
    });
});

describe("ruling 5 one container deeper: a setext underline in a quote in a list item", () => {
    beforeEach(resetNotices);
    const lines = ["- > Setext", "  > ==="];

    it("the reading reads the underline as block syntax to its end", () => {
        expect(readNote(lines).blockSyntaxEnd(1)).toBe(Infinity);
    });

    it("a press on the underline refuses instead of writing into it", async () => {
        const doc = await press(lines, 1, 5);
        // Before the fix: the underline became "  > =[^1]==" and "[^1]: " was appended.
        expect(doc.lines).toEqual(lines);
        expect(noticed(BlockSyntaxNotice)).toBe(true);
    });

    it("control: the same underline in a plain quote refuses", async () => {
        const plain = ["> Setext", "> ==="];
        const doc = await press(plain, 1, 3);
        expect(doc.lines).toEqual(plain);
    });
});
