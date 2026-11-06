import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { endOfWordForSelection } from "../../src/editor/cursor-motion";
import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (wrong output): with Expand selections to whole words on, a selection
// that ends between two words, right after a punctuation mark with the next
// word touching it, grew over that next word. Chinese and Japanese put no
// space between sentences, so selecting one whole sentence with its full stop
// and pressing moved the next sentence into the footnote as well: "英文。"
// selected in "中文，英文。第三句。" gave "中文，[^1]" with "[^1]: 英文。第三句。".
//
// What the user sees now: "中文，[^1]第三句。" with "[^1]: 英文。". The selection
// grows only when it ends strictly inside a word, the mirror of how its
// start already behaves (startOfWordOffset), so "U.|S." and "don'|t" still
// grow to the word's end.
//
// Hunt 2026-11-06, cycle 9, finding H36. Source of truth: the README, "A
// selection that starts or ends mid-word grows to whole words first".
// Severity: wrong output. Origin: pre-existing.

describe("endOfWordForSelection: an offset between two words stays put", () => {
    it("after a CJK full stop with the next sentence touching it", () => {
        expect(endOfWordForSelection("中文，英文。第三句。", 6)).toBe(6);
        expect(endOfWordForSelection("中文，英文。第三句。", 6, "before")).toBe(6);
    });

    it("after a CJK comma with the next clause touching it", () => {
        expect(endOfWordForSelection("中文，英文。第三句。", 3)).toBe(3);
    });

    it("after a closing bracket with a Latin word glued to it", () => {
        expect(endOfWordForSelection("(abc)def ghi", 5)).toBe(5);
    });

    it("at the start of a word after a space", () => {
        expect(endOfWordForSelection("abc def", 4)).toBe(4);
    });

    it("still grows from inside a word, across an inner dot or apostrophe", () => {
        expect(endOfWordForSelection("U.S. Senate", 2)).toBe(4);
        expect(endOfWordForSelection("U.S. Senate", 2, "before")).toBe(4);
        expect(endOfWordForSelection("don't stop", 4)).toBe(5);
        expect(endOfWordForSelection("abc defgh ghi.", 6)).toBe(9);
    });

    it("still takes the mark that ends the word it sits at the end of", () => {
        expect(endOfWordForSelection("中文，英文。第三句。", 5)).toBe(6);
        expect(endOfWordForSelection("word. next", 4)).toBe(5);
        expect(endOfWordForSelection("word. next", 4, "before")).toBe(4);
    });
});

/** The note's lines after the numbered key with `from` to `to` of `text` selected. */
function press(text: string, from: number, to: number, placement: "after" | "before" | "none" = "after", command = insertAutonumFootnote) {
    const doc = fakeEditor([text], {
        wholeDoc: true,
        edits: true,
        words: true,
        cursor: { line: 0, ch: to },
        selection: { anchor: { line: 0, ch: from }, head: { line: 0, ch: to } },
    });
    const settings = { expandSelectionToWholeWords: true, footnotePlacement: placement, insertAtEndOfWord: true, enablePopupEditor: false };
    return command(fakePlugin(settings, doc)).then(() => doc.lines);
}

describe("a selection ending right after a mark leaves the touching word in the note", () => {
    beforeEach(resetNotices);

    it("a whole Chinese sentence leaves the next sentence in the text", async () => {
        expect(await press("中文，英文。第三句。", 3, 6)).toEqual(["中文，[^1]第三句。", "", "[^1]: 英文。"]);
    });

    it("a Chinese clause with its comma leaves the next clause in the text", async () => {
        expect(await press("中文，英文。第三句。", 0, 3)).toEqual(["[^1]英文。第三句。", "", "[^1]: 中文，"]);
    });

    it("a whole Japanese sentence leaves the next sentence in the text", async () => {
        expect(await press("日本語です。次の文です。", 0, 6)).toEqual(["[^1]次の文です。", "", "[^1]: 日本語です。"]);
    });

    it("the same under Before", async () => {
        expect(await press("中文，英文。第三句。", 3, 6, "before")).toEqual(["中文，[^1]第三句。", "", "[^1]: 英文。"]);
    });

    it("the same with the inline key", async () => {
        expect(await press("中文，英文。第三句。", 3, 6, "after", insertInlineFootnote)).toEqual(["中文，^[英文。]第三句。"]);
    });

    it("the Latin twin, a word glued after a closing bracket", async () => {
        expect(await press("(abc)def ghi", 0, 5)).toEqual(["[^1]def ghi", "", "[^1]: (abc)"]);
    });

    // controls: these held before the fix
    it("control: the sentence without its full stop takes the stop and no more", async () => {
        expect(await press("中文，英文。第三句。", 3, 5)).toEqual(["中文，[^1]第三句。", "", "[^1]: 英文。"]);
    });

    it("control: a Latin selection ending in a space does not grow over the next word", async () => {
        expect(await press("abc def ghi.", 0, 4)).toEqual(["[^1] def ghi.", "", "[^1]: abc"]);
    });

    it("control: a selection ending truly mid-word still grows to the word's end", async () => {
        expect(await press("abc defgh ghi.", 4, 6)).toEqual(["abc[^1] ghi.", "", "[^1]: defgh"]);
    });
});
