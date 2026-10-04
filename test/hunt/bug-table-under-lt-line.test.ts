// Imported from the Kimi K3 cycle 5 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// A table cannot interrupt a paragraph (GFM): a table header directly
// under plain paragraph text is no table at all, and the "delimiter" and
// "rows" render as literal pipes inside the paragraph (Kimi hunt cycle 3,
// probed in Reading view 2026-09-16). tableRowLinesOf knows, and its
// paragraphTextAbove refuses to call the run a table when plain text sits
// above it.
//
// But its idea of "plain paragraph text" refuses ANY line that starts
// with "<", meant to catch HTML block openers. That over-fires on lines
// that are plain text everywhere, including in the plugin's own reading:
// "<3" is not a tag (CommonMark 4.6 needs a letter after the "<"), and a
// "<span>" INSIDE an open paragraph is inline HTML, not a block (type 7
// cannot interrupt a paragraph - the reading's htmlBlockOpener agrees and
// opens nothing there). Under such a line the table check says "table",
// where micromark (run as the oracle) parses one paragraph with literal
// pipes, and Reading view's recorded plain-text probe says the same.
//
// The misread cascades: the "table" ends the block above it, so a label
// directly under the run is read as a DEFINITION (Jason's ruling A2)
// where Reading view shows lazy prose - move-to-bottom then drags the
// "definition" away, reindex numbers it, orphan rules judge it.
//
// What the user sees: they write "<3" (or an inline "<span>" mid-
// paragraph) over some pipe doodles and a "[^1]:" line; the lint treats
// the label as a real footnote definition and hauls it to the bottom,
// while Reading view never showed a footnote there at all.
//
// Source of truth: GFM via the micromark oracle (one paragraph, no
// table) + the cycle-3 Reading view probe (a table header directly under
// plain paragraph text is no table; "<3" is plain paragraph text).
//
// Settings involved: none for the reading; every lint rule inherits the
// misread.

describe("a table run under a line starting with < that is plain paragraph text", () => {
    it("'<' + digit is not a tag: no table forms under '<3'", () => {
        const lines = ["<3", "| a | b |", "| --- | --- |", "[^1]: d"];
        expect(readNote(lines).tableRowLines).toEqual([false, false, false, false]);
    });

    it("and the label under the run is lazy prose, not a definition", () => {
        const lines = ["<3", "| a | b |", "| --- | --- |", "[^1]: d"];
        expect(readNote(lines).labelLines).toEqual([
            false, false, false, false,
        ]);
    });

    it("an inline '<span>' inside an open paragraph is not a block: no table under it", () => {
        const lines = ["para", "<span>", "| a | b |", "| --- | --- |", "[^1]: d"];
        expect(readNote(lines).tableRowLines).toEqual([false, false, false, false, false]);
    });

    it("control: a table after a blank line forms normally", () => {
        const lines = ["<3", "", "| a | b |", "| --- | --- |", "[^1]: d"];
        expect(readNote(lines).tableRowLines).toEqual([false, false, true, true, false]);
    });

    it("control: a real HTML block line above is not paragraph text (table may follow)", () => {
        // "<div>" alone opens a type-6 HTML block; the reading protects the
        // run, so the table question never arises - the line above being
        // "not plain text" is the right call there
        const lines = ["<div>", "| a | b |", "| --- | --- |"];
        const reading = readNote(lines);
        expect(reading.protectedLines).toEqual([true, true, true]);
    });
});
