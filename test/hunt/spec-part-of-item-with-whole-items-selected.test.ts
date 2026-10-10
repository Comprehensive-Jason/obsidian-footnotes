import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { PartOfListNotice } from "../../src/commands/selection-footnote";

// spec question, answered: a selection takes part of one list item and one
// or more whole items after it, and the numbered key is pressed.
//
// The note is "- a point", "- b point", "- c". The user drags from after
// "a" to the end of "- b point" and presses the numbered key. It converted:
// the note became "- a[^1]" over "- c", and footnote 1 held "point" with
// "- b point" under it as a list, so the second bullet left the list.
// Nothing of b's line was left behind, so ruling Q25 (a selection that
// leaves the next block without its marker) did not apply, and ruling Q31
// covered only a selection of whole items (raised in the q25-bullet run's
// report, 2026-10-09).
//
// Answered (Jason's ruling, 2026-10-09): such a selection is part of a
// list, so it is refused like Q31, the note unchanged, with "No footnote
// was created: select one item's text, or the whole list."
// (PartOfListNotice). Q31's rule is generalised rather than given a branch
// for this shape: a selection that takes items of a list, by taking the
// marker of any item, but not the whole list is refused. The same holds
// for numbered and task lists, for a list in a quote, and for a sub-list
// and the list around it. A selection that runs on past the list is judged
// the same way. Two shapes that were already refused change their notice
// to this one: part of an item into the first of its two sub-items, and a
// paragraph with only the first item of the list under it, which got "the
// selection takes part of the line's formatting. Select the whole line, or
// only its text." though the user had taken whole lines.
//
// Controls, which convert before and after the ruling: the whole list,
// one item's text, part of an item with all of its sub-items, one item's
// line selected whole (ruling Q27), and a paragraph with the whole list
// under it.
//
// Origin: pre-existing, red at f7ee233 (laptop master). Run q31-partial,
// 2026-10-09.

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

const list = ["Intro.", "", "- a point", "- b point", "- c", "", "After."];

/** Selects from `anchor` to `head` in `lines`, presses the numbered key, and gives back the note's lines. */
async function pressOver(lines: string[], anchor: EditorPosition, head: EditorPosition): Promise<string[]> {
    const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: head, selection: { anchor, head } });
    await insertAutonumFootnote(fakePlugin(settings, doc));
    return doc.lines;
}

beforeEach(resetNotices);

describe("part of one list item with whole items after it", () => {
    it.each<[string, string[], EditorPosition, EditorPosition]>([
        ["the reported note: from after 'a' to the end of '- b point'", list, { line: 2, ch: 3 }, { line: 3, ch: 9 }],
        ["the same, with the line break after it (a drag down to the next line)", list, { line: 2, ch: 3 }, { line: 4, ch: 0 }],
        ["the same, dragged from the end back to the start", list, { line: 3, ch: 9 }, { line: 2, ch: 3 }],
        ["part of the first item and every item after it", list, { line: 2, ch: 3 }, { line: 4, ch: 3 }],
        ["part of the middle item and the last one", list, { line: 3, ch: 3 }, { line: 4, ch: 3 }],
        ["a list of two items", ["- a point", "- b point"], { line: 0, ch: 3 }, { line: 1, ch: 9 }],
        ["a numbered list", ["1. a point", "2. b point", "3. c"], { line: 0, ch: 4 }, { line: 1, ch: 10 }],
        ["a task list", ["- [ ] a point", "- [ ] b point", "- [ ] c"], { line: 0, ch: 7 }, { line: 1, ch: 13 }],
        ["a list in a quote", ["> - a point", "> - b point", "> - c"], { line: 0, ch: 5 }, { line: 1, ch: 11 }],
        ["a list with blank lines between its items", ["- a point", "", "- b point", "", "- c"], { line: 0, ch: 3 }, { line: 2, ch: 9 }],
        ["an item's lazy line, then the next item", ["- a point", "more", "- b point", "- c"], { line: 1, ch: 0 }, { line: 2, ch: 9 }],
        ["part of an item and the first of its two sub-items", ["- a point", "  - s1", "  - s2", "- b"], { line: 0, ch: 4 }, { line: 1, ch: 6 }],
        ["part of a sub-item and the next sub-item", ["- a", "  - s1 x", "  - s2", "- b"], { line: 1, ch: 7 }, { line: 2, ch: 6 }],
        ["part of the last sub-item and the next item of the list around it", ["- a", "  - s1", "  - s2 x", "- b"], { line: 2, ch: 7 }, { line: 3, ch: 3 }],
        ["part of one item, the next whole, and a paragraph after the list", ["- a point", "- b point", "", "Para."], { line: 0, ch: 4 }, { line: 3, ch: 5 }],
        ["a paragraph and the first item of the list under it", ["Para.", "", "- a", "- b"], { line: 0, ch: 0 }, { line: 2, ch: 3 }],
    ])("%s: refused with the part-of-a-list notice", async (_what, lines, anchor, head) => {
        expect(await pressOver(lines, anchor, head)).toEqual(lines);
        expect(messages()).toEqual([PartOfListNotice]);
    });

    it("the named key: refused before its modal opens", async () => {
        const doc = fakeEditor([...list], { wholeDoc: true, edits: true, cursor: { line: 3, ch: 9 }, selection: { anchor: { line: 2, ch: 3 }, head: { line: 3, ch: 9 } } });
        await insertNamedFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(list);
        expect(messages()).toEqual([PartOfListNotice]);
    });

    // Controls, green before the ruling's fix as well.
    it("control: the whole list converts as whole blocks", async () => {
        const after = await pressOver(list, { line: 2, ch: 0 }, { line: 4, ch: 3 });
        expect(messages()).toEqual([]);
        expect(after.slice(0, 4)).toEqual(["Intro.", "", "[^1]", ""]);
        expect(after).toContain("[^1]: - a point");
    });

    it("control: one item's text converts", async () => {
        const after = await pressOver(list, { line: 2, ch: 4 }, { line: 2, ch: 9 });
        expect(messages()).toEqual([]);
        expect(after.slice(0, 5)).toEqual(["Intro.", "", "- a[^1]", "- b point", "- c"]);
        expect(after).toContain("[^1]: point");
    });

    it("control: one item's line selected whole converts its text (ruling Q27)", async () => {
        const after = await pressOver(list, { line: 3, ch: 0 }, { line: 3, ch: 9 });
        expect(messages()).toEqual([]);
        expect(after.slice(0, 5)).toEqual(["Intro.", "", "- a point", "- [^1]", "- c"]);
        expect(after).toContain("[^1]: b point");
    });

    it("control: part of an item with all of its sub-items converts as that item's text", async () => {
        const lines = ["- a point", "  - s1", "  - s2", "- b"];
        const after = await pressOver(lines, { line: 0, ch: 4 }, { line: 2, ch: 6 });
        expect(messages()).toEqual([]);
        expect(after.slice(0, 2)).toEqual(["- a[^1]", "- b"]);
        expect(after).toContain("[^1]: point");
    });

    it("control: a paragraph with the whole list under it converts as whole blocks", async () => {
        const after = await pressOver(list, { line: 0, ch: 0 }, { line: 4, ch: 3 });
        expect(messages()).toEqual([]);
        expect(after[0]).toBe("[^1]");
        expect(after).toContain("[^1]: Intro.");
    });
});
