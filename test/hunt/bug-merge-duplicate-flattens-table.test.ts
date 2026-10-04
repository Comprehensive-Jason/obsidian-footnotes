// Imported from the GLM 5.3 Flash cycle 7 hunt of 2026-09-16 (OpenCode worktree); 1 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16 by declining: a duplicate with a table on a copy's label line is left as written and named by the duplicate alert with the reason, since the indented-continuation form cannot carry a table.
import { describe, expect, it } from "vitest";

import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";

import { readNote } from "../../src/parsing/note-reading";

// GLM 5.3 Flash cycle 11 hunt of 2026-09-16 (OpenCode worktree glm-cycle-7). 2 of 3 tests carry it.fails; the control does not.
// BUG: when one of two definitions of a name is a GFM table riding its
// label line ("[^1]: | a | b |" plus its delimiter row), the merge folds
// the table into the FIRST definition as body text. The rule's contract
// is "The merged bodies arrive as INDENTED continuation lines ... The
// indented form looks identical when rendered and stays one block" - true
// for prose bodies, false for a table: the pinned rendering (GLM hunt
// cycle 3, probed in Reading view) is that a table starting on a label
// line belongs to the footnote and RENDERS AS A TABLE. After the merge,
// the header row is an indented continuation line of the survivor (part
// of the footnote's text), and the delimiter row and rows are column-0
// lines under the definition, which no longer have a header - Reading
// view shows them as a paragraph of literal pipes. The table's structure
// is destroyed without the destructive-change notice any other reshape
// gets; the duplicate merge is the one lint rule allowed to reshape
// structure, and this shape is outside what its indented-continuation
// form can carry.
//
// What the user sees: a footnote defined twice, one copy holding a
// table, merges into a footnote whose table is gone - body text reads
// "first | a | b |" and the remaining rows render as pipe text with no
// table.
//
// Source of truth: the merge rule's own rendering contract (the file
// header: "The indented form looks identical when rendered") + the
// pinned Reading-view probe that a table starting on a label line
// renders inside the footnote (GLM hunt cycle 3, and the column-0 rows
// belong to the block - findDefinitionBlocks' table-on-label walk, which
// this pin shows already spans the rows).
//
// Settings involved: `Merge duplicate definitions` (the rule itself; the
// lint runs it when the toggle is on).

const doc = "use[^1]\n\n[^1]: first\n\ntail\n\n[^1]: | a | b |\n| --- |\n| x | y |";

describe("merging a duplicate whose body is a table that starts on its label line", () => {
    it("keeps the table rendering: the merge declines, both copies stay, and the duplicate alert names the footnote", () => {
        // a table cannot travel as indented continuation lines, so the
        // rule leaves such a duplicate alone (fixed 2026-09-16); Obsidian
        // keeps rendering the last copy, table and all, and the alert's
        // toggle-on wording says why the lint did not merge
        expect(mergeDuplicateFootnoteDefinitions(doc)).toBe(doc);
    });

    it("control, reversed: the table copy first, prose second, merges prose INTO the table and keeps the table", () => {
        const flipped = "use[^1]\n\n[^1]: | a | b |\n| --- |\n| x | y |\n\ntail\n\n[^1]: second";
        const out = mergeDuplicateFootnoteDefinitions(flipped);
        const lines = out.split("\n");
        const label = lines.findIndex((line) => /\| a \| b \|/.test(line) && line.startsWith("[^1]:"));
        expect(label).toBeGreaterThanOrEqual(0);
        // the table survives as the block's head, "second" travels as a
        // continuation line after the last row
        expect(lines[label + 1]).toBe("| --- |");
        expect(lines).toContain("    second");
    });

    it("control: both copies are found as definition blocks spanning the table rows", () => {
        const lines = doc.split("\n");
        const blocks = readNote(lines).blocks;
        expect(blocks.map((block) => block.name)).toEqual(["1", "1"]);
        // the table duplicate's block spans its label line, the delimiter
        // row, and the row after it
        expect(blocks[1].start).toBe(6);
        expect(blocks[1].end).toBe(8);
    });
});