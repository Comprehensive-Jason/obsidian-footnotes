// Imported from the Kimi K3 cycle 4 hunt of 2026-09-16 (OpenCode worktree); 1 of 2 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// REFUTED 2026-09-16 (Kimi hunt cycle 4, probed in Reading view): GFM's cell-count rule does not apply in Obsidian; a delimiter row with fewer or more cells than the header still makes a table, so the plugin's shape-only check is right.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// spec question: is a run of pipe lines whose delimiter row has a
// DIFFERENT number of cells than its header row a table in Obsidian?
//
// GFM's table rule (spec 4.10): "The delimiter row must match the number
// of cells in the header row. If not, a table will not be recognized."
// So "| a | b |" over "| --- |" is a paragraph with literal pipes, not a
// table. The plugin's tableRowLinesOf checks only that the second line is
// delimiter-shaped; it never counts cells, so it calls the run a table.
//
// Why it matters: everything downstream of the table reading takes a side.
// A "[^x]:" label directly under the run is a definition to the plugin
// (a label under a table row starts one, Jason's ruling A2) but lazy
// paragraph text if the run is no table; an indented chunk under the run
// is code to the plugin but a lazy continuation if it is no table; and
// the definitions-inside-tables alert judges labels inside it.
//
// NEEDS A LIVE CHECK: build "| a | b |\n| --- |\n[^1]: x" in Reading
// view. If the run renders as a paragraph (GFM's rule), the plugin's
// table reader is too lenient and the label is lazy. If Obsidian is
// lenient about cell counts, the plugin is right and this closes.
//
// Source of truth: GFM spec 4.10's delimiter-cell-count rule, against the
// plugin's delimiter-shape-only check. No manual sheet records a
// mismatched run, and the in-repo oracle set has no gfm-table module, so
// this cannot be settled here.

describe("spec question: a delimiter row with fewer cells than the header", () => {
    const doc = "| a | b |\n| --- |\n[^1]: x";

    it("the plugin reads the run as a table (the premise to verify)", () => {
        expect(readNote(doc.split("\n")).tableRowLines.slice(0, 2)).toEqual([true, true]);
    });

    it("REFUTED: Obsidian renders the run as a table anyway, so the label under it is a definition", () => {
        // fewer or more delimiter cells than the header, both render as a
        // table with the footnote under it working (probed 2026-09-16)
        const lines = doc.split("\n");
        const starts = readNote(lines).labelLines;
        expect(starts[2]).toBe(true);
    });
});
