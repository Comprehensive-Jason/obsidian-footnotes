// Imported from the GLM 5.3 Flash cycle 4 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// Hunt cycle 8 (GLM 5.3 Flash, 2026-09-16): a table directly under a LAZY
// label line is marked as a table, which promotes the label under the
// "table" to a phantom definition start.
//
// Scenario (prose, a lazy label, a pipe run with a delimiter row, another
// label):
//
//   prose text
//   [^1]: lazy
//   | a | b |
//   | --- | --- |
//   [^2]: under
//
// What the user would see in Reading view: "[^1]: lazy" sits directly
// under a prose line, so it is paragraph text (manual sheet 14: a label
// under prose renders as plain "[^1]: ..." with no footnote). A table
// cannot interrupt a paragraph - the very rule pinned in
// test/hunt/bug-setext-underline-makes-heading.test.ts ("a header row
// directly under plain text is no table") - and a lazy label IS plain
// text. So the pipe run renders as one paragraph with literal pipes, and
// "[^2]: under", directly under that paragraph, is lazy too. NOTHING in
// the note is a definition.
//
// What goes wrong: tableRowLinesOf's paragraphTextAbove judges the line
// above the pipe run through a plainText check whose ender regex carries
// a "\[\^" alternative - every label-shaped line is treated as a BLOCK
// there, so the run of paragraph text breaks at the lazy label and the
// table is allowed to start. (That alternative exists for REAL labels: a
// table under a real definition's label line is a separate table, pinned
// in the cycle 3/4 fixes. It cannot tell a real label from a lazy one.)
// definitionStartLines then sees tableRows[i] on the delimiter row, resets
// its state to "none", and starts a definition at "[^2]: under".
//
// What the user would see from the plugin: no lazy-definition alert names
// "[^2]:" (the plugin thinks it already IS a definition), and "Move
// definitions to the bottom" gathers the line to the note's end - the
// lint relocates a line of prose Obsidian renders in place. With orphan
// deletion on, the phantom definition is also renumbered and reordered
// like a real one.
//
// Source of truth: manual sheet 14 (a label directly under prose is lazy;
// its quote and callout fixtures cover the quoted shapes) + the probed
// table-cannot-interrupt-a-paragraph rule pinned in
// bug-setext-underline-makes-heading.test.ts. Ruling A2 (a label under a
// table ROW is a definition) does not reach here: nothing says a table
// may start under a label that is itself paragraph text.
//
// Settings involved: none for the scan; "Move definitions to the bottom"
// (default on) for the consequence test.

import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

import { readNote } from "../../src/parsing/note-reading";

const LAZY_TABLE = "prose text\n[^1]: lazy\n| a | b |\n| --- | --- |\n[^2]: under".split("\n");

describe("a table cannot start under a lazy label", () => {
    it("the pipe run under the lazy label is no table", () => {
        expect(readNote(LAZY_TABLE).tableRowLines).toEqual([false, false, false, false, false]);
    });

    it("so the label under the run stays lazy: no definition starts there", () => {
        expect(readNote(LAZY_TABLE).labelLines).toEqual([
            false,
            false,
            false,
            false,
            false,
        ]);
    });

    it("the move rule leaves the lazy label line where the user wrote it", () => {
        const doc = LAZY_TABLE.join("\n");
        expect(moveFootnoteDefinitionsToBottom(doc)).toBe(doc);
    });

    it("control: a table under a REAL definition's label is a separate table (pinned cycle 3/4)", () => {
        const lines = "para\n\n[^1]: real\n| a | b |\n| --- | --- |".split("\n");
        expect(readNote(lines).tableRowLines).toEqual([false, false, false, true, true]);
    });

    it("control: a table under a real definition's lazy continuation is a table (pinned)", () => {
        const lines = "[^1]: x\nlazy\n| a | b |\n| --- | --- |".split("\n");
        expect(readNote(lines).tableRowLines).toEqual([false, false, true, true]);
    });
});
