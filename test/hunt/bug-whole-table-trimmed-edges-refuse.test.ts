import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { TableSelectionNotice } from "../../src/commands/selection-footnote";
import { readNote } from "../../src/parsing/note-reading";

// BUG: a whole table selected edge to edge is refused, with the toast that
// says the selection cuts through a table, when the table's last row ends
// in trailing spaces or the table is indented by one space.
//
// What the user would see: they select the table from its very first
// character to its very last one, press the numbered hotkey, and get
// "No footnote was created: the selection cuts through a table. Select
// text inside one cell, or the whole table with the text around it." The
// advice cannot be followed, because the selection already IS the whole
// table. There is no gesture that satisfies the check for such a table:
// dragging to the visible end of the last row lands short of the trailing
// spaces, and dragging past them has the whitespace trimmed back off
// again. Trailing spaces are invisible, so the user has no way of knowing
// why the same gesture works on one table and not on the one below it.
//
// Hunt: 2026-09-13. Lens: selection conversion, table edges.
//
// Source of truth:
//  - manual sheet 05's ruling (2026-09-09): "Select the table ALONE, edge
//    to edge ... both convert", pinned in test/selection-to-footnote.test.ts.
//  - GFM 4.10 (tables): trailing whitespace on a row, and up to three
//    spaces of leading indent, leave the table exactly the table it was.
//
// Cause: trimSelectionEdges pulls `to.ch` back off the trailing whitespace
// (and `from.ch` forward past the indent), and selectionCutsTable then
// tests the trimmed positions against the RAW line: it wants from.ch === 0
// and to.ch === the raw line length.

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

beforeEach(resetNotices);

describe("a whole table whose last row ends in trailing spaces", () => {
    const lines = [
        "before the table",
        "",
        "| a | b |",
        "| --- | --- |",
        "| one | two |  ",
        "",
        "after the table",
    ];

    // The premise, green today: the trailing spaces change nothing about
    // what the lines are.
    it("the premise: all three lines are still table rows", () => {
        expect(readNote(lines).tableRowLines).toEqual([
            false,
            false,
            true,
            true,
            true,
            false,
            false,
        ]);
    });

    it("converts when dragged to the true end of the last row", async () => {
        const doc = fakeEditor(lines, { line: 2, ch: 0 }, { line: 4, ch: lines[4].length });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(TableSelectionNotice)).toBe(false);
        expect(doc.lines[2]).toBe("[^1]");
    });

    it("converts when dragged to the last visible character instead", async () => {
        const doc = fakeEditor(
            lines,
            { line: 2, ch: 0 },
            { line: 4, ch: lines[4].trimEnd().length },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(TableSelectionNotice)).toBe(false);
        expect(doc.lines[2]).toBe("[^1]");
    });
});

describe("a whole table indented one space", () => {
    const lines = [
        "before the table",
        "",
        " | a | b |",
        " | --- | --- |",
        " | one | two |",
        "",
        "after the table",
    ];

    it("the premise: the indented lines are still table rows", () => {
        expect(
            readNote(lines).tableRowLines.slice(2, 5),
        ).toEqual([true, true, true]);
    });

    it("converts when selected edge to edge", async () => {
        const doc = fakeEditor(lines, { line: 2, ch: 0 }, { line: 4, ch: lines[4].length });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(TableSelectionNotice)).toBe(false);
        expect(doc.lines[2]).toBe("[^1]");
    });
});

describe("the same table with neither quirk", () => {
    // The control: the ruled-on gesture works today on a table with no
    // trailing spaces and no indent.
    it("converts edge to edge (control)", async () => {
        const lines = [
            "before the table",
            "",
            "| a | b |",
            "| --- | --- |",
            "| one | two |",
            "",
            "after the table",
        ];
        const doc = fakeEditor(lines, { line: 2, ch: 0 }, { line: 4, ch: lines[4].length });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(TableSelectionNotice)).toBe(false);
        expect(doc.lines[2]).toBe("[^1]");
    });
});
