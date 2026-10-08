import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { TableSelectionNotice } from "../../src/commands/selection-footnote";

// BUG (wrong output): a selection that starts in the prose above a table
// and ends inside the table's last row converts, and the table's header
// and delimiter rows move into the footnote.
//
// What the user would see: "before the table", a blank line, then the
// table "| a | b |", "| --- | --- |", "| one | two |". They drag from
// "the table" to just after "| on" and press the numbered key. The first
// line becomes "before[^1]e | two |", the table is gone from the page, and
// footnote 1 holds "the table", the header row, the delimiter row, and
// "| on". The selection should have been refused with "No footnote was
// created: the selection cuts through a table. Select text inside one
// cell, or the whole table with the text around it."
//
// The "result gate" is the one check every edit passes before it is
// written: the note after must read the same as the note before, except
// for what the edit meant to change.
//
// Hunt 2026-10-08, cycle 6. Cluster Z5.
//
// Origin: regression from 99d4e6d, where the result gate took over the
// selection's refusals and the table check became only a way to pick the
// notice.
//
// Source of truth: Jason's ruling 2026-09-04 on partial-table selections
// (test/selection-to-footnote.test.ts, "partial-table selections refuse":
// moving a row or part of one into a footnote shreds the table left
// behind). Its own shape, prose above through the header row, still
// refuses (the control below).
//
// Cause: the gate's check 5 compares how each line reads before and after.
// Where a changed stretch has fewer lines after than before, it compares
// only the first pair of lines (blockShapeVerdict in
// src/editor/result-gate.ts, the `pairs` count). Here that pair is the
// first line, which stays a paragraph, so the gate never looks at the
// table's last row, whose leftover text "e | two |" has joined the
// paragraph.

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

describe("a selection from the prose above a table into its last row", () => {
    // The same note as the ruling's own test in test/selection-to-footnote.test.ts.
    const table = ["before the table", "", "| a | b |", "| --- | --- |", "| one | two |", "", "after the table"];

    // Now: "before[^1]e | two |", and footnote 1 holds "the table", the
    // header, the delimiter, and "| on".
    it.fails("from 'the table' to inside the last row's first cell refuses with the table notice", async () => {
        expect(await pressOver(table, { line: 0, ch: 7 }, { line: 4, ch: 4 })).toEqual(table);
        expect(noticed(TableSelectionNotice)).toBe(true);
    });

    // Now: "[^1] two |", and footnote 1 holds the first line, the header,
    // the delimiter, and "| one |".
    it.fails("from the start of the prose through the header and delimiter and into the last row refuses with the table notice", async () => {
        expect(await pressOver(table, { line: 0, ch: 0 }, { line: 4, ch: 7 })).toEqual(table);
        expect(noticed(TableSelectionNotice)).toBe(true);
    });

    it("control (the ruling's own shape): the prose above through the header row alone refuses with the table notice", async () => {
        expect(await pressOver(table, { line: 0, ch: 0 }, { line: 2, ch: 9 })).toEqual(table);
        expect(noticed(TableSelectionNotice)).toBe(true);
    });
});
