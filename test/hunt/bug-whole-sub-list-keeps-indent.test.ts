import { EditorPosition } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { PartOfListNotice } from "../../src/commands/selection-footnote";

// A whole sub-list (every sub-item under one list item) selected and the
// numbered key pressed. It went down the whole-block path, as a whole list
// does (ruling Q25): "- A" / "  - s1" / "  - s2" / "- B" with s1 and s2
// selected became "- A" / "  [^1]" / "- B" with "[^1]: - s1" / "      - s2".
// The second line kept the sub-list's 2-space indent, and in a footnote
// that indent nests: Obsidian draws s2 as a sub-item of s1 (live answer
// lr:sub-items in test/obsidian-answers/list-run-live.json). The "[^1]"
// line was also a lazy line of A, more of A's text rather than an item.
//
// A whole sub-list is a run of whole items, so it follows Jason's ruling
// of 2026-10-17 for runs (spec-whole-items-move-into-footnote): the
// reference goes at the end of the item the sub-list sits under, and the
// items leave with the sub-list's indent taken off, so the footnote holds
// them as a flat list. The orchestrator applied the ruling to this shape
// under Jason's standing approval (2026-10-17).
//
// Origin: pre-existing, red at bbd022c and at b2ba314; found while probing
// in run list-run, fixed in run sublist, 2026-10-17.

const settings = {
    insertAtEndOfWord: false,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
    expandSelectionToWholeWords: false,
};

/** Selects from `anchor` to `head` in `lines`, presses the numbered key, and gives back the note's lines. */
async function pressOver(lines: string[], anchor: EditorPosition, head: EditorPosition): Promise<string[]> {
    const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: head, selection: { anchor, head } });
    await insertAutonumFootnote(fakePlugin(settings, doc));
    return doc.lines;
}

beforeEach(resetNotices);

describe("a whole sub-list moves into a new footnote as a flat list", () => {
    const reported = ["- A", "  - s1", "  - s2", "- B"];

    it.each<[string, EditorPosition, EditorPosition]>([
        ["dragged from the start of the line of s1 to the end of s2", { line: 1, ch: 0 }, { line: 2, ch: 6 }],
        ["dragged from the end of s2 back to the start", { line: 2, ch: 6 }, { line: 1, ch: 0 }],
        ["dragged from the bullet of s1", { line: 1, ch: 2 }, { line: 2, ch: 6 }],
        ["with the line break after it (two lines triple-clicked)", { line: 1, ch: 0 }, { line: 3, ch: 0 }],
    ])("the reported note, %s: the reference ends A", async (_what, anchor, head) => {
        expect(await pressOver(reported, anchor, head)).toEqual(["- A[^1]", "- B", "", "[^1]: - s1", "    - s2"]);
        expect(messages()).toEqual([]);
    });

    it("the sub-list of the list's last item, at the end of the note", async () => {
        const lines = ["Reasons:", "- A", "  - s1", "  - s2"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 3, ch: 6 })).toEqual(["Reasons:", "- A[^1]", "", "[^1]: - s1", "    - s2"]);
        expect(messages()).toEqual([]);
    });

    it("a numbered sub-list keeps its numbers as typed", async () => {
        const lines = ["- A", "  1. s1", "  2. s2", "- B"];
        expect(await pressOver(lines, { line: 1, ch: 0 }, { line: 2, ch: 7 })).toEqual(["- A[^1]", "- B", "", "[^1]: 1. s1", "    2. s2"]);
        expect(messages()).toEqual([]);
    });

    it("a sub-list two levels down: the reference ends the sub-item it sits under", async () => {
        const lines = ["- A", "  - s1", "    - t1", "    - t2", "  - s2"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 3, ch: 8 })).toEqual(["- A", "  - s1[^1]", "  - s2", "", "[^1]: - t1", "    - t2"]);
        expect(messages()).toEqual([]);
    });

    it("a sub-item's own sub-items go with it, still nested under it", async () => {
        const lines = ["- A", "  - s1", "    - t1", "  - s2", "- B"];
        expect(await pressOver(lines, { line: 1, ch: 0 }, { line: 3, ch: 6 })).toEqual(["- A[^1]", "- B", "", "[^1]: - s1", "      - t1", "    - s2"]);
        expect(messages()).toEqual([]);
    });
});

describe("unchanged by the fix", () => {
    it("the whole list with its sub-list converts as whole blocks (ruling Q25)", async () => {
        const lines = ["Reasons:", "", "- A", "  - s1", "  - s2", "- B"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 5, ch: 3 })).toEqual(["Reasons:", "", "[^1]", "", "[^1]: - A", "      - s1", "      - s2", "    - B"]);
        expect(messages()).toEqual([]);
    });

    it("the last sub-item with the next item of the list around it is refused", async () => {
        const lines = ["- A", "  - s1", "  - s2", "- B", "- C"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 3, ch: 3 })).toEqual(lines);
        expect(messages()).toEqual([PartOfListNotice]);
    });

});

// Converted down the same whole-block path before, as "-" / "  [^1]". Now
// refused like the first sub-items under such an item are
// (spec-whole-items-move-into-footnote): no text above can hold the
// reference. A rare shape, left to the refusal.
describe("refused with the list notice, the note unchanged", () => {
    it("a sub-list under an item holding no text", async () => {
        const lines = ["-", "  - s1", "  - s2", "- B"];
        expect(await pressOver(lines, { line: 1, ch: 0 }, { line: 2, ch: 6 })).toEqual(lines);
        expect(messages()).toEqual([PartOfListNotice]);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});
