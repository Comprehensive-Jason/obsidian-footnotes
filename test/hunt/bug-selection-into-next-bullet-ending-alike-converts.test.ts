import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { SelectionFormattingNotice } from "../../src/commands/selection-footnote";

// bug: a selection from one bullet into the next converts when the two
// bullets end in the same words.
//
// The note is "- First point" over "- Second point". The user drags from
// after "First" to after "- Second", taking the second bullet's marker and
// part of its text, and presses the numbered key. Jason's ruling Q25
// (2026-10-08, extended) refuses a selection that leaves the next block
// without its marker, with the selection's formatting notice; with
// "- apples are" over "- pears are sweet" it does (pinned in
// spec-selection-ends-in-next-block-marker). Here it converted: the note
// became "- First[^1] point", footnote 1 held " point" and "- Second", and
// the second bullet was gone from the list (found 2026-10-09 while writing
// the beta.7 sheets).
//
// Cause: the result gate's check 5 lines up the lines before and after the
// edit by their text without footnotes. What the selection left,
// "- First[^1] point", is "- First point" without its reference, the very
// text of the first bullet before, because the second bullet ended in
// " point" too. So the gate took the line for the first bullet with only
// a reference added, took the second bullet for a line deleted whole, and
// never asked whether what was left of the second bullet lost its marker.
// The check that asks it also guessed from the text whether anything of
// the last line was left, and the same coincidence fooled it. With
// "- Second thing" the leftover reads "- First thing", which matches no
// line, so the gate compared the joined lines and refused.
//
// Fixed in the same run: the selection command tells the gate the stretch
// its reference replaces (CreatedFootnote's `replaced`), and check 5 lines
// up the selection's lines by where they ran and reads what is left of the
// last one off the note.
//
// Origin: pre-existing (red at 0dd399b, the beta.7 release with docs).
// Run q25-bullet, 2026-10-09.

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

/** Selects from `anchor` to `head`, presses the numbered key, and gives back the note's lines. */
async function pressOver(lines: string[], anchor: EditorPosition, head: EditorPosition): Promise<string[]> {
    const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: head, selection: { anchor, head } });
    await insertAutonumFootnote(fakePlugin(settings, doc));
    return doc.lines;
}

beforeEach(resetNotices);

describe("a selection into the next block whose leftover reads like the line it joins", () => {
    it.each<[string, string[], EditorPosition, EditorPosition]>([
        ["the reported note: from after 'First' through '- Second'", ["- First point", "- Second point"], { line: 0, ch: 7 }, { line: 1, ch: 8 }],
        ["the same, dragged from the end back to the start", ["- First point", "- Second point"], { line: 1, ch: 8 }, { line: 0, ch: 7 }],
        ["bullets ending in 'item'", ["- First item", "- Second item"], { line: 0, ch: 7 }, { line: 1, ch: 8 }],
        ["numbered items", ["1. First point", "2. Second point"], { line: 0, ch: 8 }, { line: 1, ch: 9 }],
        ["a paragraph into a quote", ["Para point", "", "> Quote point"], { line: 0, ch: 4 }, { line: 2, ch: 7 }],
        ["a paragraph into a heading", ["Para point", "", "# Head point"], { line: 0, ch: 4 }, { line: 2, ch: 6 }],
    ])("%s refuses", async (_what, lines, anchor, head) => {
        expect(await pressOver(lines, anchor, head)).toEqual(lines);
        expect(noticed(SelectionFormattingNotice)).toBe(true);
    });

    // Controls, green before the fix as well.
    it("control: bullets ending in different words refuse", async () => {
        const lines = ["- First point", "- Second thing"];
        expect(await pressOver(lines, { line: 0, ch: 7 }, { line: 1, ch: 8 })).toEqual(lines);
        expect(noticed(SelectionFormattingNotice)).toBe(true);
    });

    it("control: two lines of one quote ending alike convert", async () => {
        const out = await pressOver(["> First point", "> Second point"], { line: 0, ch: 7 }, { line: 1, ch: 8 });
        expect(out[0]).toBe("> First[^1] point");
        expect(noticed(SelectionFormattingNotice)).toBe(false);
    });

    it("control: two lines of one paragraph ending alike convert", async () => {
        const out = await pressOver(["First point", "Second point"], { line: 0, ch: 5 }, { line: 1, ch: 6 });
        expect(out[0]).toBe("First[^1] point");
        expect(noticed(SelectionFormattingNotice)).toBe(false);
    });

    it("control: a paragraph and the whole list under it convert as whole blocks", async () => {
        const out = await pressOver(["Intro point", "", "- First point", "- Second point", "", "after"], { line: 0, ch: 5 }, { line: 3, ch: 14 });
        expect(out.slice(0, 3)).toEqual(["Intro[^1]", "", "after"]);
    });
});
