// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 2 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16 (Kimi hunt cycle 3, probed in Reading view): the column-0 rows render as a table INSIDE the footnote, so the block walker owns them. A table that starts on its own line under a label ("[^1]: x" then "| a | b |") is a separate table outside the footnote, and a header row directly under plain paragraph text is no table at all (a table cannot interrupt a paragraph), both probed the same day.
import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION: "[^1]: | a | b |" followed at column 0 by the table's
// delimiter and rows - is the table part of the footnote, or does the
// footnote end at its label line?
//
// The pinned ground truth nearby (bug-block-first-line-on-label, sheet
// 07): "Obsidian renders `[^1]: | a | b |` with the rows INDENTED below
// it as a table". The column-0 twin is unprobed. Two readings:
//
//   Reading one (GFM tables): a table is a leaf block whose rows need no
//   indent, and the delimiter row converts the definition's first
//   paragraph line into the table's header - so the footnote holds the
//   whole table, and the block walker must own lines 1-2. The walker
//   currently owns only the label line, so move-to-bottom cuts the label
//   away from its rows: "[^1]: | a | b |" lands at the bottom alone and
//   the delimiter and row are stranded at the top, the table destroyed.
//
//   Reading two (the walker's): the definition's continuation is an
//   indented line; a column-0 delimiter row is not one, so the footnote
//   is the label line alone and the "table" below never was one.
//
// micromark-without-gfm-table agrees with reading two only in outline
// (it reads no table at all without the extension), and the repo carries
// no GFM-table oracle, so the question is for Reading view.
//
// NEEDS A LIVE CHECK: in Reading view, does "[^1]: | a | b |", "| --- |
// --- |", "| c | d |" render a table INSIDE footnote 1? If yes, the
// block walker must absorb the column-0 rows (and move-to-bottom's cut
// is a conservation bug); if no, the walker is right.
//
// Source of truth: Reading view (unprobed); the indented twin is pinned
// by sheet 05. Settings involved: `Move definitions to the bottom`
// (default ON).

describe("spec: a table's column-0 rows under a definition label that starts it", () => {
    it("the block walker owns the column-0 rows (micromark+GFM-table's expected reading)", () => {
        const lines = "[^1]: | a | b |\n| --- | --- |\n| c | d |\n\ntext[^1]".split("\n");
        const blocks = readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }));
        expect(blocks).toEqual([{ name: "1", start: 0, end: 2 }]);
    });

    it("move-to-bottom keeps the label with its rows", () => {
        // the whole table travels as one block (the definition was above
        // its reference, so it does move)
        const doc = "[^1]: | a | b |\n| --- | --- |\n| c | d |\n\ntext[^1]";
        expect(moveFootnoteDefinitionsToBottom(doc)).toBe("text[^1]\n\n[^1]: | a | b |\n| --- | --- |\n| c | d |");
    });

    it("control: the INDENTED rows are the definition's (the pinned sheet-07 shape)", () => {
        const lines = "[^1]: | a | b |\n    | --- | --- |\n    | c | d |\n\ntext[^1]".split("\n");
        const blocks = readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }));
        expect(blocks).toEqual([{ name: "1", start: 0, end: 2 }]);
    });
});
