import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { resetNotices } from "./helpers/notices";
import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";

// A selection across lines, turned into a footnote, joins what is left of
// its first line and its last line into one line. The result gate's check
// 5 compares what is left of the last line too: it must keep its own kind
// of block, prose staying prose, a table row a row, a heading a heading
// (hunt 2026-10-08, cycle 6, cluster Z5), and its containers, and the last
// line may not have started a block other than a paragraph, whose marker
// the selection would take (Jason's ruling Q25, 2026-10-08).

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

describe("what is left of a selection's last line", () => {
    it("converts a selection across two lines of one paragraph, its leftover still prose", async () => {
        const out = await pressOver(["Oysters filter water", "all day long."], { line: 0, ch: 15 }, { line: 1, ch: 7 });
        expect(out[0]).toBe("Oysters filter[^1] long.");
    });

    it("converts a selection from prose to the very end of a table, which leaves nothing of the table's last row", async () => {
        const table = ["before the table", "", "| a | b |", "| --- | --- |", "| one | two |", "", "after the table"];
        const out = await pressOver(table, { line: 0, ch: 7 }, { line: 4, ch: 13 });
        expect(out.slice(0, 3)).toEqual(["before[^1]", "", "after the table"]);
    });

    it("refuses a selection from prose into a table's last row, whose leftover would read as prose", async () => {
        const table = ["before the table", "", "| a | b |", "| --- | --- |", "| one | two |"];
        expect(await pressOver(table, { line: 0, ch: 7 }, { line: 4, ch: 7 })).toEqual(table);
    });

    // Expectation changed (Jason's ruling Q25, 2026-10-08): this was a
    // characterization test, pinning that " end" left its list item and
    // joined the prose ("Intro text[^1] end"). The ruling refuses it.
    it("refuses a selection from prose into a list item's text, whose leftover would leave its list item", async () => {
        const lines = ["Intro text here", "", "- listed end"];
        expect(await pressOver(lines, { line: 0, ch: 11 }, { line: 2, ch: 8 })).toEqual(lines);
    });
});
