import { beforeEach, describe, expect, it } from "vitest";

import { insertInTableCell } from "../../src/commands/create-footnote";
import type { TableCellEditor } from "../../src/editor/table-cursor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance, low priority): in a table cell, a press at the end of an
// email address followed by a period is refused, where the same press in
// the text around a table lands in front of the period.
//
// What the user would see: a table cell that reads "Write to
// me@example.com.". With the caret after the period, or on the address,
// they press the numbered key. The press is refused with the notice that
// says Obsidian would read the footnote as part of a link. In a paragraph
// the same press writes "me@example.com[^1]." (Jason's ruling Q30).
//
// A "cell" here is the small editor Obsidian opens inside a table cell
// while the user types in it; the plugin writes into it through its own
// route (insertInTableCell), never through the main editor.
//
// Hunt 2026-10-08, cycle 7. Cluster Y11.
//
// Origin: red at 97abeac, this cycle's origin, which came before the
// ruling. Q30's change, ebc9450 (2026-10-08), changed only the main
// editor's landing, so a cell never had it.
//
// Source of truth: Jason's ruling Q30 (sprout-c6-rulings.md 6,
// 2026-10-08): a press at the end of an email address followed by a
// period lands in front of the period, under After and Before. The live
// answer in c7-verdicts-raw.md (sprout Obsidian 1.14.4, Reading view,
// 2026-10-08), now the table-cell sentence of
// docs/obsidian-reading-rules.md D8: "| Write to me@example.com.[^1] |"
// links "mailto:me@example.com." with the period and shows footnote 1;
// "| Write to me@example.com[^1]. |" links the address alone and shows
// footnote 1. So a table cell reads like a paragraph here, and the landing
// in front of the period is right in a cell too.
//
// Cause: insertInTableCell (src/commands/create-footnote.ts) works out
// where the reference lands with its own steps (endOfWordOffset, then
// safeInsertionCh). It never calls adjustFootnotePosition, where Q30's
// landing in front of the period lives, so it lands after the period, the
// link would take the period, and the result gate refuses.

/** A stand-in for a cell's editor holding `text` with the caret at `head`, which records what the plugin sends it. */
function fakeCell(text: string, head: number) {
    const dispatched: unknown[] = [];
    const cell: TableCellEditor = {
        state: { doc: { toString: () => text }, selection: { main: { head, anchor: head } } },
        dispatch: (spec) => {
            dispatched.push(spec);
        },
    };
    return { cell, dispatched };
}

beforeEach(resetNotices);

describe("Q30's landing in a table cell", () => {
    it("control: after a plain sentence's period the reference lands after it", () => {
        const { cell, dispatched } = fakeCell("Oysters filter water.", 21);
        insertInTableCell(cell, fakePlugin({ insertAtEndOfWord: true, footnotePlacement: "after" }), "[^1]", 4);
        expect(dispatched).toEqual([{ changes: { from: 21, to: 21, insert: "[^1]" }, selection: { anchor: 25 } }]);
    });

    // Now: refused with the link notice, and nothing sent to the cell.
    it.fails("a press after the period lands in front of it, under After", () => {
        const { cell, dispatched } = fakeCell("Write to me@example.com.", 24);
        insertInTableCell(cell, fakePlugin({ insertAtEndOfWord: true, footnotePlacement: "after" }), "[^1]", 4);
        expect(messages()).toEqual([]);
        expect(dispatched).toEqual([{ changes: { from: 23, to: 23, insert: "[^1]" }, selection: { anchor: 27 } }]);
    });

    it.fails("a press on the address lands in front of the period, under After", () => {
        const { cell, dispatched } = fakeCell("Write to me@example.com.", 15);
        insertInTableCell(cell, fakePlugin({ insertAtEndOfWord: true, footnotePlacement: "after" }), "[^1]", 4);
        expect(messages()).toEqual([]);
        expect(dispatched).toEqual([{ changes: { from: 23, to: 23, insert: "[^1]" }, selection: { anchor: 27 } }]);
    });
});
