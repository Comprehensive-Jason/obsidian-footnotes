import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { messages, noticed, resetNotices } from "../helpers/notices";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { TableSelectionNotice } from "../../src/commands/selection-footnote";

// spec question: should a selection that runs edge to edge across SEVERAL
// whole tables convert?
//
// Hunt: 2026-09-13. Lens: selection conversion, table edges.
//
// Two whole tables with a blank line between them, selected from the first
// table's first character to the second table's last character, is refused
// today with the cuts-through-a-table toast. Widening the drag does not
// help: taken from the blank line above the first table to the blank line
// below the second, the blank edges are trimmed away and the selection
// ends up on the same two table rows, so it refuses again. ONE whole table
// converts with either gesture, so the user sees the same drag work on one
// table and refuse on two, with a toast whose advice ("select the whole
// table with the text around it") they have already followed.
//
// Reading A: this is the whole-table rule missing a case. The refusal
// exists to stop a table being shredded, and nothing here is shredded, so
// a run of whole tables (and the blank lines between them) should convert
// the way one whole table does.
// Reading B: the ruling in sheet 05 is about ONE table, and a selection
// over several is out of scope by design. Then the bug is only in the
// toast, which is giving advice that cannot be followed.
//
// Source of truth: manual sheet 05's ruling (2026-09-09), "a whole table
// selected edge to edge (with or without the text around it) converts; a
// partial table refuses"; the rule is silent on more than one table.
//
// Cause of the old behavior: selectionCutsTable demanded that every line
// from the first to the last be a table row, and the blank line between
// the two tables is not one.
//
// Answered (Jason's ruling on list A, 2026-10-08, stage 3 of the result
// gate design): the result gate decides, and it gives reading A: both
// tables move whole into the footnote and read the same there, so the
// selection converts. The two tests were it.fails until then. How the
// footnote renders is on the manual selection-to-footnote sheet for
// Jason to look at.

function fakeEditor(
    lines: string[],
    anchor: EditorPosition,
    head: EditorPosition,
): FakeEditor {
    return sharedFakeEditor(lines, {
        cursor: anchor,
        selection: { anchor, head },
        edits: true,
        wholeDoc: true,
    });
}

function fakePlugin(doc: FakeEditor, overrides = {}): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            expandSelectionToWholeWords: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: false,
            lintOnFootnoteCreation: false,
            ...overrides,
        },
        doc,
    );
}

const TWO_TABLES = [
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "| c | d |",
    "| --- | --- |",
    "| 3 | 4 |",
];

beforeEach(resetNotices);

describe("two whole tables in one selection", () => {
    it("edge to edge across both tables converts", async () => {
        const doc = fakeEditor(
            TWO_TABLES,
            { line: 0, ch: 0 },
            { line: 6, ch: TWO_TABLES[6].length },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(TableSelectionNotice)).toBe(false);
        expect(doc.lines[0]).toBe("[^1]");
    });

    it("the wider drag, blank line to blank line, converts them too", async () => {
        const lines = ["before", "", ...TWO_TABLES, "", "after"];
        const doc = fakeEditor(lines, { line: 1, ch: 0 }, { line: 10, ch: 0 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(TableSelectionNotice)).toBe(false);
        expect(doc.lines[2]).toBe("[^1]");
    });
});

describe("one whole table, the same two gestures (control)", () => {
    const lines = [
        "before",
        "",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "after",
    ];

    it("edge to edge converts", async () => {
        const doc = fakeEditor(lines, { line: 2, ch: 0 }, { line: 4, ch: lines[4].length });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(messages()).toEqual([]);
        expect(doc.lines[2]).toBe("[^1]");
    });

    it("blank line to blank line converts", async () => {
        const doc = fakeEditor(lines, { line: 1, ch: 0 }, { line: 5, ch: 0 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(messages()).toEqual([]);
        expect(doc.lines[2]).toBe("[^1]");
        expect(doc.lines.at(-1)).toBe("    | 1 | 2 |");
    });
});
