import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
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
// stops growing only after a mark that ends a sentence or a CJK mark, so
// "U.|S." and "don'|t" still grow to the word's end.
//
// Any other mark still grows, as it always did: hunt cycle 10 found that
// stopping after every mark left "a[^1]known thing" for "a |well-|known
// thing", "[^1]000 units" for "|1,|000 units", and a link refusal for a drag
// ending on an address's slash.
//
// Hunt 2026-11-06, cycle 9, finding H36, narrowed in cycle 10 (press finding
// 5). Source of truth: the README, "A selection that starts or ends mid-word
// grows to whole words first". Severity: wrong output. Origin: pre-existing.

describe("endOfWordForSelection: an offset right after a stop stays put", () => {
    it("after a CJK full stop with the next sentence touching it", () => {
        expect(endOfWordForSelection("中文，英文。第三句。", 6)).toBe(6);
        expect(endOfWordForSelection("中文，英文。第三句。", 6, "before")).toBe(6);
    });

    it("after a CJK comma with the next clause touching it", () => {
        expect(endOfWordForSelection("中文，英文。第三句。", 3)).toBe(3);
    });

    it("after a CJK closing bracket with the next sentence touching it", () => {
        expect(endOfWordForSelection("（注）次の文", 3)).toBe(3);
    });

    it("after an exclamation mark or a question mark with a word glued to it", () => {
        expect(endOfWordForSelection("Stop!Next word", 5)).toBe(5);
        expect(endOfWordForSelection("Why?Next word", 4)).toBe(4);
    });

    it("after a stop with a closer in front of it", () => {
        expect(endOfWordForSelection('(see).Next word', 6)).toBe(6);
    });
});

describe("endOfWordForSelection: an offset right after any other mark grows", () => {
    it.each([
        ["well-known thing", 5, 10],
        ["1,000 units", 2, 5],
        ["10:30 today", 3, 5],
        ["see #tag now", 5, 8],
        ["cost $5 now", 6, 7],
        ["http://example.com/path now", 19, 23],
        ["(abc)def ghi", 5, 8],
        ["abc def", 4, 7],
    ])("%s from %i to %i", (text, from, to) => {
        expect(endOfWordForSelection(text, from)).toBe(to);
    });
});

describe("endOfWordForSelection: an offset inside a word grows", () => {
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

    it("the Latin twin, a word glued after an exclamation mark", async () => {
        expect(await press("Stop!Next word", 0, 5)).toEqual(["[^1]Next word", "", "[^1]: Stop!"]);
    });

    // Characterization (behaviour pinned as it is): a CJK sentence ended by an
    // ASCII full stop still takes the next sentence in, since a dot between
    // two word characters counts as inside a word, as in "U.S." The decision
    // for Jason of 2026-11-06 leaves this as it was on 0fb8ac3 (hunt 2026-11-06,
    // cycle 10, press finding 6).
    it("characterization: a CJK sentence with an ASCII stop grows over the next one", async () => {
        expect(await press("第一句.第二句.", 0, 4)).toEqual(["[^1]", "", "[^1]: 第一句.第二句."]);
        expect(await press("第一句.第二句.", 0, 4, "before")).toEqual(["[^1].", "", "[^1]: 第一句.第二句"]);
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

describe("a selection ending right after a joining mark takes the whole word", () => {
    beforeEach(resetNotices);

    it("a hyphen", async () => {
        expect(await press("a well-known thing", 2, 7)).toEqual(["a[^1] thing", "", "[^1]: well-known"]);
    });

    it("a number's comma", async () => {
        expect(await press("1,000 units", 0, 2)).toEqual(["[^1] units", "", "[^1]: 1,000"]);
    });

    it("an address's slash, so the whole address goes and nothing is refused", async () => {
        expect(await press("see http://example.com/path now", 4, 23)).toEqual(["see[^1] now", "", "[^1]: http://example.com/path"]);
        expect(messages()).toEqual([]);
    });

    it("a closing bracket", async () => {
        expect(await press("(abc)def ghi", 0, 5)).toEqual(["[^1] ghi", "", "[^1]: (abc)def"]);
    });
});
