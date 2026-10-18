import { EditorPosition, Modal } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { ConvertedSelection, convertSelectionToNamed, InlineSelectionNotice, PartOfListNotice } from "../../src/commands/selection-footnote";
import { readNote } from "../../src/parsing/note-reading";

// Jason's ruling, 2026-10-17, replacing the refusal of ruling Q31 for whole
// items: a selection of a run of whole list items (one or more items in a
// row, each taken whole, in a bulleted, numbered, or task list, at the
// list's start, middle, or end) and a footnote key moves those items into a
// new footnote.
//
// - The reference goes at the end of the item just above the run. When
//   the run starts at the list's first item, it goes at the end of the
//   paragraph introducing the list, the paragraph right above it. With no
//   paragraph above (the list opens the note, or sits under a heading or
//   only blank lines), the selection is refused with the list notice.
// - The footnote's text is the moved items as a list, numbers kept as
//   typed: "3. C" / "4. D" becomes "[^1]: 3. C" / "    4. D". The list left
//   in the note stays a list.
// - Unchanged: a selection taking PART of an item stays refused, one item's
//   line selected whole converts its text (ruling Q27), and a whole list, or
//   a paragraph with its whole list, converts as whole blocks (ruling Q25).
//   The inline key refuses a selection spanning lines, as before.
//
// Source of truth: the ruling, and three notes Jason had sprout's Obsidian
// 1.14.4 read on 2026-10-17 (saved in test/obsidian-answers/list-run-live.json).
// "Reasons:" / "" / "- A" / "- B[^1]" / "- E" / "" / "[^1]: - C" / "    - D"
// draws the list A, B, E and a list C, D inside footnote 1; the numbered
// twin draws an ordered list starting at 3 inside the footnote; and
// "Reasons:[^1]" / "" / "- C" / "- D" / "" / "[^1]: - A" / "    - B" draws
// the list C, D and the list A, B in the footnote.
//
// Two readings of the ruling are this run's own, flagged for Jason in the
// list-run report. An item above the run that has sub-items takes the
// reference at the end of its own text, not of its last sub-item, which
// would make it the sub-item's footnote. A list inside a quote or a callout
// stays refused: its items' "> " markers cannot move into a footnote.
//
// Origin: new behaviour; every test that converts below was refused at
// bbd022c (the commit this run started from). Run list-run, 2026-10-17.

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

const reasons = ["Reasons:", "", "- A", "- B", "- C", "- D", "- E", "", "After."];

/** Selects from `anchor` to `head` in `lines`, presses the numbered key, and gives back the note's lines. */
async function pressOver(lines: string[], anchor: EditorPosition, head: EditorPosition): Promise<string[]> {
    const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: head, selection: { anchor, head } });
    await insertAutonumFootnote(fakePlugin(settings, doc));
    return doc.lines;
}

beforeEach(resetNotices);

describe("a run of whole list items moves into a new footnote", () => {
    it.each<[string, EditorPosition, EditorPosition]>([
        ["dragged from the start of '- C' to the end of '- D'", { line: 4, ch: 0 }, { line: 5, ch: 3 }],
        ["dragged from the end back to the start", { line: 5, ch: 3 }, { line: 4, ch: 0 }],
        ["with the line break after it (two lines triple-clicked)", { line: 4, ch: 0 }, { line: 6, ch: 0 }],
    ])("the middle of a list, %s: the reference ends the item above", async (_what, anchor, head) => {
        expect(await pressOver(reasons, anchor, head)).toEqual(["Reasons:", "", "- A", "- B[^1]", "- E", "", "After.", "", "[^1]: - C", "    - D"]);
        expect(messages()).toEqual([]);
    });

    it("the end of a list: the reference ends the item above", async () => {
        expect(await pressOver(reasons, { line: 5, ch: 0 }, { line: 6, ch: 3 })).toEqual(["Reasons:", "", "- A", "- B", "- C[^1]", "", "After.", "", "[^1]: - D", "    - E"]);
        expect(messages()).toEqual([]);
    });

    it("the start of a list: the reference ends the paragraph introducing it", async () => {
        expect(await pressOver(reasons, { line: 2, ch: 0 }, { line: 3, ch: 3 })).toEqual(["Reasons:[^1]", "", "- C", "- D", "- E", "", "After.", "", "[^1]: - A", "    - B"]);
        expect(messages()).toEqual([]);
    });

    it("the start of a list right under its paragraph, with no blank line between", async () => {
        const lines = ["Reasons:", "- A", "- B", "- C"];
        expect(await pressOver(lines, { line: 1, ch: 0 }, { line: 2, ch: 3 })).toEqual(["Reasons:[^1]", "- C", "", "[^1]: - A", "    - B"]);
        expect(messages()).toEqual([]);
    });

    it("a numbered list: the numbers are kept as typed in the footnote", async () => {
        const lines = ["Steps:", "", "1. A", "2. B", "3. C", "4. D", "5. E"];
        expect(await pressOver(lines, { line: 4, ch: 0 }, { line: 5, ch: 4 })).toEqual(["Steps:", "", "1. A", "2. B[^1]", "5. E", "", "[^1]: 3. C", "    4. D"]);
        expect(messages()).toEqual([]);
    });

    it("a task list at the end of the note, its boxes kept", async () => {
        const lines = ["Todo:", "- [ ] A", "- [x] B", "- [ ] C"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 3, ch: 7 })).toEqual(["Todo:", "- [ ] A[^1]", "", "[^1]: - [x] B", "    - [ ] C"]);
        expect(messages()).toEqual([]);
    });

    it("a list with blank lines between its items, in the middle: the blank line under the run goes with it", async () => {
        const lines = ["Reasons:", "", "- A", "", "- B", "", "- C", "", "- D"];
        expect(await pressOver(lines, { line: 4, ch: 0 }, { line: 6, ch: 3 })).toEqual(["Reasons:", "", "- A[^1]", "", "- D", "", "[^1]: - B", "    ", "    - C"]);
        expect(messages()).toEqual([]);
    });

    it("a list with blank lines between its items, at the end: the blank line above the run goes with it", async () => {
        const lines = ["- A", "", "- B", "", "- C", "", "After."];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 4, ch: 3 })).toEqual(["- A[^1]", "", "After.", "", "[^1]: - B", "    ", "    - C"]);
        expect(messages()).toEqual([]);
    });

    it("one item with its sub-items: the sub-items go with it", async () => {
        const lines = ["Reasons:", "- A", "- B", "  - b1", "  - b2", "- C"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 4, ch: 6 })).toEqual(["Reasons:", "- A[^1]", "- C", "", "[^1]: - B", "      - b1", "      - b2"]);
        expect(messages()).toEqual([]);
    });

    it("one item over two lines: its second line goes with it", async () => {
        const lines = ["Reasons:", "- A", "- B", "  more B", "- C"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 3, ch: 8 })).toEqual(["Reasons:", "- A[^1]", "- C", "", "[^1]: - B", "      more B"]);
        expect(messages()).toEqual([]);
    });

    it("sub-items in the middle of their list: the reference ends the sub-item above", async () => {
        const lines = ["- A", "  - s1", "  - s2", "  - s3", "- B"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 3, ch: 6 })).toEqual(["- A", "  - s1[^1]", "- B", "", "[^1]: - s2", "    - s3"]);
        expect(messages()).toEqual([]);
    });

    it("the first sub-items of their list: the reference ends the item they sit under", async () => {
        const lines = ["- A", "  - s1", "  - s2", "  - s3", "- B"];
        expect(await pressOver(lines, { line: 1, ch: 0 }, { line: 2, ch: 6 })).toEqual(["- A[^1]", "  - s3", "- B", "", "[^1]: - s1", "    - s2"]);
        expect(messages()).toEqual([]);
    });

    it("the item above has sub-items: the reference ends its own text, not its last sub-item", async () => {
        const lines = ["- A", "  - a1", "- B", "- C"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 3, ch: 3 })).toEqual(["- A[^1]", "  - a1", "", "[^1]: - B", "    - C"]);
        expect(messages()).toEqual([]);
    });

    it("an item holding a code block and a code span: the code moves with it and is still code in the footnote's item", async () => {
        const lines = ["Reasons:", "- A", "- B uses `x`", "  ```", "  code", "  ```", "- C"];
        const after = await pressOver(lines, { line: 2, ch: 0 }, { line: 5, ch: 5 });
        expect(after).toEqual(["Reasons:", "- A[^1]", "- C", "", "[^1]: - B uses `x`", "      ```", "      code", "      ```"]);
        expect(messages()).toEqual([]);
        expect(readNote(after).lineBlocks[6]).toBe("footnoteDefinition list listItem code");
    });

    it("the item above ends in a block id: the reference goes in front of it", async () => {
        const lines = ["Reasons:", "- A ^a1", "- B", "- C"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 3, ch: 3 })).toEqual(["Reasons:", "- A[^1] ^a1", "", "[^1]: - B", "    - C"]);
        expect(messages()).toEqual([]);
    });

    it("the named key: the modal opens, and the name typed into it names the footnote", async () => {
        let opened: { target: { selection: ConvertedSelection } } | undefined;
        const open = vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
            opened = this as unknown as typeof opened;
        });
        const doc = fakeEditor([...reasons], { wholeDoc: true, edits: true, cursor: { line: 5, ch: 3 }, selection: { anchor: { line: 4, ch: 0 }, head: { line: 5, ch: 3 } } });
        const plugin = fakePlugin(settings, doc);
        await insertNamedFootnote(plugin);
        open.mockRestore();
        expect(messages()).toEqual([]);
        expect(doc.lines).toEqual(reasons);
        if (opened === undefined) throw new Error("the modal did not open");
        expect(convertSelectionToNamed(plugin, doc, opened.target.selection, "why")).toBeNull();
        expect(doc.lines).toEqual(["Reasons:", "", "- A", "- B[^why]", "- E", "", "After.", "", "[^why]: - C", "    - D"]);
    });

    it("the named key: a note changed under the open modal is noticed", async () => {
        let opened: { target: { selection: ConvertedSelection } } | undefined;
        const open = vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
            opened = this as unknown as typeof opened;
        });
        const doc = fakeEditor([...reasons], { wholeDoc: true, edits: true, cursor: { line: 5, ch: 3 }, selection: { anchor: { line: 4, ch: 0 }, head: { line: 5, ch: 3 } } });
        const plugin = fakePlugin(settings, doc);
        await insertNamedFootnote(plugin);
        open.mockRestore();
        if (opened === undefined) throw new Error("the modal did not open");
        doc.lines[3] = "- B changed";
        expect(convertSelectionToNamed(plugin, doc, opened.target.selection, "why")).toBeNull();
        expect(doc.lines[3]).toBe("- B changed");
        expect(doc.lines).not.toContain("[^why]: - C");
    });

    it("the inline key: refused as a selection spanning lines, as before", async () => {
        const doc = fakeEditor([...reasons], { wholeDoc: true, edits: true, cursor: { line: 5, ch: 3 }, selection: { anchor: { line: 4, ch: 0 }, head: { line: 5, ch: 3 } } });
        await insertInlineFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(reasons);
        expect(messages()).toEqual([InlineSelectionNotice]);
    });
});

describe("refused with the list notice, the note unchanged", () => {
    it.each<[string, string[], EditorPosition, EditorPosition]>([
        ["the list opens the note", ["- A", "- B", "- C"], { line: 0, ch: 0 }, { line: 1, ch: 3 }],
        ["the list sits right under a heading", ["# Title", "- A", "- B", "- C"], { line: 1, ch: 0 }, { line: 2, ch: 3 }],
        ["the list sits under a heading and a blank line", ["# Title", "", "- A", "- B", "- C"], { line: 2, ch: 0 }, { line: 3, ch: 3 }],
        ["only blank lines above the list", ["", "", "- A", "- B", "- C"], { line: 2, ch: 0 }, { line: 3, ch: 3 }],
        ["a sub-list whose item above holds no text", ["-", "  - s1", "  - s2", "  - s3"], { line: 1, ch: 0 }, { line: 2, ch: 6 }],
        // the item above ends in code, where a reference is no footnote; a
        // rare shape, left to this refusal rather than to code of its own
        ["the item above ends in a code block", ["Reasons:", "- A", "  ```", "  code", "  ```", "- B", "- C"], { line: 5, ch: 0 }, { line: 6, ch: 3 }],
        ["the last item is not taken whole: its second paragraph stays", ["Reasons:", "- A", "- B", "", "  more B", "- C"], { line: 1, ch: 0 }, { line: 2, ch: 3 }],
        ["the last item is not taken whole: one of its sub-items stays", ["Reasons:", "- A", "- B", "  - b1", "  - b2", "- C"], { line: 2, ch: 0 }, { line: 3, ch: 6 }],
        ["the run starts after the first item's marker", ["Reasons:", "- A", "- B", "- C", "- D"], { line: 2, ch: 2 }, { line: 3, ch: 3 }],
        ["items of two lists, the second starting where the first ends", ["Reasons:", "- A", "- B", "1. C", "2. D"], { line: 2, ch: 0 }, { line: 3, ch: 4 }],
        ["the last sub-item and the next item of the list around it", ["- A", "  - s1", "  - s2", "- B", "- C"], { line: 2, ch: 0 }, { line: 3, ch: 3 }],
        ["a list in a quote", ["> Reasons:", "> - A", "> - B", "> - C"], { line: 2, ch: 0 }, { line: 3, ch: 5 }],
        ["part of one item with the whole next one (the q31-partial ruling)", ["- a point", "- b point", "- c"], { line: 0, ch: 3 }, { line: 1, ch: 9 }],
    ])("%s", async (_what, lines, anchor, head) => {
        expect(await pressOver(lines, anchor, head)).toEqual(lines);
        expect(messages()).toEqual([PartOfListNotice]);
    });

    it("a numbered list right under its paragraph: the items left would start at 3, which cannot break into a paragraph", async () => {
        const lines = ["Steps:", "1. A", "2. B", "3. C"];
        expect(await pressOver(lines, { line: 1, ch: 0 }, { line: 2, ch: 4 })).toEqual(lines);
        expect(messages()).toEqual([PartOfListNotice]);
    });
});

describe("controls, unchanged by the ruling", () => {
    it("one item's line selected whole converts its text (ruling Q27)", async () => {
        expect(await pressOver(reasons, { line: 4, ch: 0 }, { line: 4, ch: 3 })).toEqual(["Reasons:", "", "- A", "- B", "- [^1]", "- D", "- E", "", "After.", "", "[^1]: C"]);
        expect(messages()).toEqual([]);
    });

    it("the whole list converts as whole blocks (ruling Q25)", async () => {
        expect(await pressOver(reasons, { line: 2, ch: 0 }, { line: 6, ch: 3 })).toEqual(["Reasons:", "", "[^1]", "", "After.", "", "[^1]: - A", "    - B", "    - C", "    - D", "    - E"]);
        expect(messages()).toEqual([]);
    });

    it("a paragraph with its whole list converts as whole blocks (ruling Q25)", async () => {
        const after = await pressOver(reasons, { line: 0, ch: 0 }, { line: 6, ch: 3 });
        expect(after.slice(0, 3)).toEqual(["[^1]", "", "After."]);
        expect(messages()).toEqual([]);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});
