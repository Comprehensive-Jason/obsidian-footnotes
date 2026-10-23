import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";

import { insertInTableCell } from "../../src/commands/create-footnote";
import { TableCellEditor } from "../../src/editor/table-cursor";
import { ProtectedCreationNotice } from "../helpers/toasts";

// Jason's retest, sheet 06 (2026-09-11): in the bottom-right cell of a bare
// table in Live Preview, the inline and paste keys SOMETIMES toasted the
// protected-text refusal while the numbered and named keys never did. Six
// scripted rounds could not reproduce it with a fresh cell, and the pure
// born-dead check refuses only true nesting. What the inline path has that
// the numbered path survives is a caret offset read straight from the cell
// editor and used to slice its text: an offset left over from a LONGER cell
// (Obsidian rebuilds the cell editor after an undo or a row re-sync) reads
// past the text, the simulated insertion then lands nowhere, and the
// born-dead check refuses it. So every cell path now clamps the caret to
// the cell's text before it slices, and this pins the stale case.

function cellWith(text: string, head: number): TableCellEditor & { dispatched: unknown[] } {
    const dispatched: unknown[] = [];
    return {
        state: { doc: { toString: () => text }, selection: { main: { head, anchor: head } } },
        dispatch: (spec: unknown) => dispatched.push(spec),
        dispatched,
    };
}

describe("a stale caret offset in a table cell", () => {
    beforeEach(resetNotices);

    it("an inline placeholder lands at the end of the cell instead of being refused", () => {
        const cell = cellWith("DDD", 7);
        const ok = insertInTableCell(cell, fakePlugin({ insertAtEndOfWord: false }), "^[]", 2);
        expect(ok).toBe(true);
        expect(noticed(ProtectedCreationNotice)).toBe(false);
        expect(cell.dispatched).toEqual([{ changes: { from: 3, to: 3, insert: "^[]" }, selection: { anchor: 5 } }]);
    });

    it("a numbered reference does the same", () => {
        const cell = cellWith("DDD", 12);
        expect(insertInTableCell(cell, fakePlugin({ insertAtEndOfWord: true }), "[^1]", 4)).toBe(true);
        expect(cell.dispatched).toEqual([{ changes: { from: 3, to: 3, insert: "[^1]" }, selection: { anchor: 7 } }]);
    });
});
