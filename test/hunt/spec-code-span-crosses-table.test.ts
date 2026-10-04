// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 2 of 2 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16: Reading view keeps a reference in the next row live (probed), so a span never crosses a table row; the search stops at rows and a run opened in a row never looks ahead.
import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// SPEC QUESTION, not a confirmed bug: an unclosed backtick run in a table
// row, with the closing run on a LATER row of the same table.
//
// The scanner's cross-line code-span search (closesAhead) stops at every
// construct that ends a paragraph - fences, headings, rules, setext
// underlines, quote markers, bullets, ordered-1 items, HTML block
// openers - but NOT at a table's delimiter row. From "| `code |" it
// finds the closer on "| span` |" and masks the header row's tail, the
// WHOLE delimiter row, and the next row's opener as one code span. The
// plugin's own table model disagrees with itself: tableRowLines reads
// the masked delimiter row as "protected", so no table is detected at
// all, and the table-edge caret guard stands down.
//
// micromark WITHOUT its table extension parses the three rows as one
// paragraph with a code span across them, which is what the plugin says
// too - so the oracle cannot referee this. The referee would be GFM's
// table extension: the delimiter row ends the header row, and a code
// span in a cell cannot cross rows.
//
// NEEDS A LIVE CHECK: does Reading view render "| `code[^1] |\n| --- |\n
// | span` |" as a table (the [^1] live in the header cell, the backticks
// literal) or as one paragraph with a code span?
//
// What the user would see if Reading view renders a table: the [^1] in
// the header cell is dead text to the plugin (no number reserved, no
// alert), and a caret on the delimiter row is refused as "protected
// text" when it is a table row.
//
// Source of truth (if a live check confirms it): GFM's table extension
// (the delimiter row ends the header; cell content is inline per row).
//
// Settings involved: none - the mask decides liveness everywhere.

const doc = "| `code[^1] |\n| --- |\n| span` |";

describe("spec question: a code span crossing a table's delimiter row", () => {
    it("needs a live check: the delimiter row is not code to Obsidian", () => {
        // today: the whole delimiter row is masked as the phantom span's interior
        expect(readNote(doc.split("\n")).protectedLines[1]).toBe(false);
    });

    it("needs a live check: the plugin's own table model still sees the table", () => {
        const lines = doc.split("\n");
        expect(readNote(lines).tableRowLines).toEqual([true, true, true]);
    });
});
