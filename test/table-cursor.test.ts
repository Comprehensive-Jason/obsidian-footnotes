import { describe, expect, it } from "vitest";

import { tableRowCellSpans } from "../src/editor/table-cursor";
import { tableRowLinesOf } from "../src/parsing/markdown-scan";

// The escape-aware cell geometry that resolveTableCellCursor uses to map a
// cell-local caret back to a document position. Only this slicing is
// unit-testable; finding the live cell sub-editor (findFromDOM) is a
// contract with Obsidian and lives in the smoke suite's table test.

describe("tableRowCellSpans", () => {
    it("returns one span per cell of a simple row", () => {
        // spans cover the raw cell text INCLUDING the padding spaces;
        // callers trim, this function only locates
        expect(tableRowCellSpans("| a | b |")).toEqual([
            { from: 1, to: 4 },
            { from: 5, to: 8 },
        ]);
    });

    it("treats text after the last pipe as an unclosed trailing cell", () => {
        expect(tableRowCellSpans("| a | b")).toEqual([
            { from: 1, to: 4 },
            { from: 5, to: 7 },
        ]);
    });

    it("does not split a cell on an escaped pipe", () => {
        expect(tableRowCellSpans("| a \\| b |")).toEqual([
            { from: 1, to: 9 },
        ]);
    });

    // spec changed 2026-07-17 (hunt): the leading pipe is optional in GFM,
    // so text before the first pipe IS the first cell - the old behavior
    // dropped it and every later cellIndex resolved to the wrong span
    it("treats text before the first pipe as the first cell", () => {
        expect(tableRowCellSpans("x | y |")).toEqual([
            { from: 0, to: 2 },
            { from: 3, to: 6 },
        ]);
    });

    it("yields a zero-width span for an empty cell", () => {
        expect(tableRowCellSpans("||")).toEqual([{ from: 1, to: 1 }]);
    });

    it("returns no spans for an empty line", () => {
        expect(tableRowCellSpans("")).toEqual([]);
    });

    it("returns no spans for a line without pipes", () => {
        expect(tableRowCellSpans("plain prose, no table here")).toEqual([]);
    });
});

// Which lines are rows of a GFM table, as the note reading finds them
// (the editor's own reader went in step 2 of the runtime swap,
// 2026-10-03). Powers the partial-table selection refusal (Jason's ruling
// 2026-09-04).
describe("tableRowLinesOf", () => {

    it("marks the header, delimiter, and body rows, not the prose around them", () => {
        // a blank line before the header: a table cannot interrupt a
        // paragraph in Reading view (Kimi hunt cycle 3), and since GLM hunt
        // cycle 7 the editor's reader follows the scanner's on that
        const lines = ["before", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "after"];
        expect(tableRowLinesOf(lines)).toEqual([false, false, true, true, true, false, false]);
    });

    it("a header with its delimiter row and no body is still a table", () => {
        const lines = ["| a | b |", "| --- | --- |"];
        expect(tableRowLinesOf(lines)).toEqual([true, true]);
    });

    it("accepts alignment colons and pipe-less edges on the delimiter row", () => {
        const lines = ["a | b", ":--- | ---:", "1 | 2"];
        expect(tableRowLinesOf(lines)).toEqual([true, true, true]);
    });

    it("a pipe line without a delimiter row below it is prose", () => {
        const lines = ["a | b", "1 | 2", "x | y"];
        expect(tableRowLinesOf(lines)).toEqual([false, false, false]);
    });

    it("the run ends at the first pipe-less line", () => {
        const lines = ["| a |", "| --- |", "| 1 |", "prose", "| 2 |"];
        expect(tableRowLinesOf(lines)).toEqual([true, true, true, false, false]);
    });

    it("protected lines (a fenced table) are never rows", () => {
        const lines = ["```", "| a |", "| --- |", "| 1 |", "```"];
        expect(tableRowLinesOf(lines)).toEqual([
            false, false, false, false, false,
        ]);
    });

    it("quoted tables count, quote marks stripped for the delimiter test", () => {
        // the blank quote line for the same reason (probed 2026-09-16: a
        // quoted table directly under quoted prose is literal pipes)
        const lines = ["> intro", ">", "> | a | b |", "> | --- | --- |", "> | 1 | 2 |"];
        expect(tableRowLinesOf(lines)).toEqual([false, false, true, true, true]);
    });

    it("a delimiter row needs at least one dash cell", () => {
        const lines = ["| a |", "|   |", "| 1 |"];
        expect(tableRowLinesOf(lines)).toEqual([false, false, false]);
    });
});
