// Imported from the glm-cycle-11 hunt of 2026-09-16 (OpenCode worktree); all pins flipped green 2026-09-16 after the fix.
// RESOLVED 2026-09-16 (GLM hunt cycle 11, all four shapes probed in Reading view: the table renders outside the footnote after a comment block's closer, a math block's closer, a wide-gap item's code line, and a link reference definition). The table reader now knows those lines as blocks of their own.
// GLM 5.3 Flash cycle 11 hunt of 2026-09-16 (OpenCode worktree glm-cycle-11). 6 of 9 tests carry it.fails; the controls do not.
import { describe, expect, it } from "vitest";

import {
    definitionStartLines,
    findDefinitionBlocks,
    maskProtectedLines,
    scanDocument,
    tableRowLinesOf,
} from "../../src/parsing/markdown-scan";
import { lintFootnotes } from "../../src/linting/linter";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

// BUG: the table reader's paragraphTextAbove (tableRowLinesOf in
// markdown-scan.ts) judges "is the line above plain paragraph text" from the
// line's SHAPE alone and never consults the protection facts. So a
// definition label that sits directly under a line which is NOT paragraph
// text - a type-2 HTML comment block's "-->" closer line, a "$$" math
// block's closer, the wide-gap list item's protected code line, or a link
// reference definition line - is judged "a label directly under prose, lazy
// text", the table under that definition is declared "no table" (a table
// cannot interrupt a paragraph), and the block walker's lazy-continuation
// absorption then takes the table's rows INTO the definition block.
//
// Every one of those above-lines makes the label a DEFINITION (the label
// walk knows: a label starts after a protected line, after a link reference
// definition, after a comment block - all recorded), and a table under a
// definition is a SEPARATE table, not the footnote's body (the pinned
// cycle-3 ruling: "a table that starts on the label line belongs to the
// footnote, a table under a label or its lazy line is a separate table").
//
// What the user would see: they write a definition under an HTML comment (or
// close a math block, or have a wide-gap list item above) and put a table
// under it. Move definitions to the bottom drags the whole table INTO the
// footnote, where Reading view now renders it as part of the footnote's text
// - the table's home changed with one lint. The next lint judges the moved
// note differently (the table now starts under a label with a blank line
// above the label), pulls the table back out below the definition, and the
// note still is not settled: lint twice is not lint once (manual former sheet 20's
// contract: the second lint must say "No linting needed.").
//
// Source of truth: the plugin's own pinned readings - a label under a
// protected line / a link reference definition / a comment block is a
// definition (definitionStartLines's own doc and the cycle-5/6 pins), and a
// table under a label is a separate table (cycle 3) - plus the idempotence
// contract the lint pins itself (test/properties.test.ts, "lint is
// idempotent for every document and option combo"). The table reader
// disagrees with all of them on these adjacencies.
//
// Settings involved: `Move definitions to the bottom` (the drag), and every
// rule that reads blocks (the orphan and duplicate readers inherit the
// inflated extent).

const opts = { fixPunctuation: true, fixLazyDefinitions: true, moveDefinitionsToBottom: true, reindex: true };

describe("a real table under a definition label that follows a block line", () => {
    it("under a label after an HTML comment block's closer line, the rows are a table", () => {
        const lines = "<!--\nc\n-->\n[^1]: body\n| a | b |\n| --- | --- |".split("\n");
        expect(tableRowLinesOf(lines)).toEqual([false, false, false, false, true, true]);
    });

    it("under a label after a $$ math block's closer line", () => {
        const lines = "$$\nm\n$$\n[^1]: body\n| a | b |\n| --- | --- |".split("\n");
        expect(tableRowLinesOf(lines)).toEqual([false, false, false, false, true, true]);
    });

    it("under a label after a wide-gap list item's protected code line", () => {
        // the item's text is indented code (pinned cycle 14), so the label
        // under it is a definition, and the table under the definition starts
        const lines = "-      item\n[^1]: body\n| a | b |\n| --- | --- |".split("\n");
        // (the hunter's expectation called the code line a row; it is not)
        expect(tableRowLinesOf(lines)).toEqual([false, false, true, true]);
    });

    it("under a label after a link reference definition line", () => {
        const lines = "[foo]: /url\n[^1]: body\n| a | b |\n| --- | --- |".split("\n");
        expect(tableRowLinesOf(lines)).toEqual([false, false, true, true]);
    });

    it("the block walker keeps the table out of the definition block", () => {
        const lines = "<!--\nc\n-->\n[^1]: body\n| a | b |\n| --- | --- |".split("\n");
        const scan = scanDocument(lines);
        const masked = maskProtectedLines(lines, scan);
        const starts = definitionStartLines(lines, scan, (i) => masked[i]);
        expect(findDefinitionBlocks(lines, scan, masked, starts).map((b) => [b.start, b.end])).toEqual([[3, 3]]);
    });

    it("move-to-bottom leaves the table where it is and gathers only the definition", () => {
        // the correct gather: the table (a separate table) stays below the
        // comment, the definition lands under it - NOT the definition+table
        // block dragged together with the table inside the footnote
        const doc = "<!--\nc\n-->\n[^1]: body\n| a | b |\n| --- | --- |";
        // a table directly under the comment's closer is a table (probed
        // 2026-09-16), so the move needs no blank line there
        expect(moveFootnoteDefinitionsToBottom(doc, "")).toBe(
            "<!--\nc\n-->\n| a | b |\n| --- | --- |\n\n[^1]: body",
        );
    });

    it("the full lint settles in one pass", () => {
        const doc = "<!--\nc\n-->\n[^1]: body\n| a | b |\n| --- | --- |";
        const once = lintFootnotes(doc, opts);
        expect(lintFootnotes(once, opts)).toBe(once);
    });

    it("orphan deletion never eats the table with the definition", () => {
        // the inflated block makes the definition's cut span the table rows:
        // with `Delete orphaned definitions` ON the whole table is deleted
        // with the orphan, while Reading view renders the table OUTSIDE the
        // footnote and would have kept every cell
        const doc = "<!--\nc\n-->\n[^1]: body\n| a | b |\n| --- | --- |";
        const cut = removeOrphanedFootnoteDefinitions(doc);
        expect(cut).toContain("| a | b |");
        expect(cut).not.toContain("[^1]: body");
    });

    it("control: a table under a lazy label is no table (pinned, cycle 8)", () => {
        // the one case the table reader is right about: the label really is
        // lazy paragraph text there
        const lines = "prose\n[^1]: lazy label\n| a | b |\n| --- | --- |".split("\n");
        expect(tableRowLinesOf(lines)).toEqual([false, false, false, false]);
    });

    it("control: a table under a definition with a blank line above the label is a table", () => {
        const lines = "prose\n\n[^1]: body\n| a | b |\n| --- | --- |".split("\n");
        expect(tableRowLinesOf(lines)).toEqual([false, false, false, true, true]);
    });

    it("the block walker keeps the table out of the block under a wide-gap item's code line too", () => {
        const lines = "-      item\n[^1]: body\n| a | b |\n| --- | --- |".split("\n");
        const scan = scanDocument(lines);
        const masked = maskProtectedLines(lines, scan);
        const starts = definitionStartLines(lines, scan, (i) => masked[i]);
        // the label is a lazy line of the item, so the note reading puts the
        // definition inside the item, on its one line: not a block that
        // moves (Jason's ruling 1, option a, 2026-10-03), and the table
        // stays out of it
        expect(findDefinitionBlocks(lines, scan, masked, starts)).toEqual([]);
        expect(starts[1]).toBe(true);
    });
});
