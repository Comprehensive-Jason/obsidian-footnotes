import { beforeEach, describe, expect, it } from "vitest";

import { insertInTableCell } from "../../src/commands/create-footnote";
import type { TableCellEditor } from "../../src/editor/table-cursor";
import type { FootnotePlacement } from "../../src/parsing/landing";
import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// BUG (wrong output): in a table cell, a press inside a link the note
// defines writes the footnote inside the link.
//
// What the user would see: a table cell holds "I said [some text] here",
// and the note has a "[some text]: http://u" line, so "[some text]" is a
// link. With the caret in "some", the numbered key writes the reference
// between the link's brackets, which splits the link: it stops being a
// link. The same row edited in the main editor refuses with the link
// notice.
//
// Hunt 2026-10-05, round 2, lens press. Cluster P2.
//
// Source of truth: Obsidian 1.14.4, asked live on 2026-10-05: Reading
// view draws "[some text]" inside a table cell as a link when the note
// has a "[some text]: http://u" line outside the table. Jason's landing
// rulings of 2026-09-15 (a reference never splits a link).
//
// Cause: the cell editor's press reads only the cell's own text
// (insertInTableCell and cellLinkLikeEndAt in src/parsing/landing.ts),
// so it never sees the note's link reference definitions, which 6d37374
// made the test for whether "[some text]" is a link. The test hands the
// plugin the whole note as its active editor, so a fix that reads the
// note's link labels from there can see them.

const Settings = (footnotePlacement: FootnotePlacement) => ({
    insertAtEndOfWord: true,
    footnotePlacement,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
});

function fakeCell(text: string, head: number) {
    const dispatched: { changes?: { from: number; to?: number; insert: string } }[] = [];
    const cell: TableCellEditor = {
        state: { doc: { toString: () => text }, selection: { main: { head, anchor: head } } },
        dispatch: (spec) => {
            dispatched.push(spec);
        },
    };
    return { cell, dispatched };
}

beforeEach(resetNotices);

describe("table cell and a reference link the note defines", () => {
    it.fails("cell editor: a press inside a link the note defines never splits it", () => {
        const note = ["| a | I said [some text] here |", "| --- | --- |", "", "[some text]: http://u"];
        const cellText = "I said [some text] here";
        const { cell, dispatched } = fakeCell(cellText, "I said [so".length);
        const doc = fakeEditor(note, { cursor: { line: 0, ch: "| a | I said [so".length }, wholeDoc: true });
        insertInTableCell(cell, fakePlugin(Settings("none"), doc), "[^1]", 4);
        const change = dispatched[0]?.changes;
        // Whatever is written must not land between the brackets of the link.
        const inside = change !== undefined && change.from > "I said ".length && change.from <= "I said [some text".length;
        expect(inside).toBe(false);
    });
});
