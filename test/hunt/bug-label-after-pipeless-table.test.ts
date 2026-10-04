// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";

import { readNote } from "../../src/parsing/note-reading";

// A GFM table row need not start with a pipe: "a | b" is a valid row
// (GFM: "A leading and trailing pipe is also recommended for clarity of
// reading, but is optional"). So "a | b\n--- | ---" is a table, and a
// "[^x]:" label directly under it is a definition, because a definition
// ends the table the way any block does - Jason's ruling A2 (2026-09-15,
// verified in Reading view), the same rule the plugin already applies to
// the pipe-delimited form.
//
// The definition-start rule's table test (definitionStartLines in
// markdown-scan.ts) insists on the leading pipe ("^ {0,3}\|"), so the
// label under the pipe-less table is a LAZY label to the plugin. The
// plugin's own table model disagrees: tableRowLines detects the table
// just fine.
//
// What the user sees: with the fix ON the lint inserts a blank line that
// changes nothing's rendering; with it OFF the alert advises "Add a
// blank line above it" for a label that already renders as a footnote -
// the same wrong advice as the rest of the lazy-label family.
//
// Source of truth: GFM's table extension (outer pipes optional) +
// Jason's ruling A2 for the pipe-delimited case + the plugin's own
// tableRowLines, which already accepts this row.
//
// Settings involved: `Fix definitions hidden by a missing blank line`
// and its alert twin.

const doc = "a | b\n--- | ---\n[^1]: x\n\nuse[^1]";

describe("a definition label directly under a table row without a leading pipe", () => {
    it("is a definition (the A2 ruling), not a lazy label", () => {
        const lines = doc.split("\n");
        const starts = readNote(lines).labelLines;
        expect(starts[2]).toBe(true);
    });

    it("the lazy fix does not insert a blank line that changes nothing", () => {
        expect(fixLazyDefinitions(doc)).toBe(doc);
    });

    it("control: the plugin's own table model accepts the pipe-less table", () => {
        const lines = doc.split("\n");
        expect(readNote(lines).tableRowLines).toEqual([true, true, false, false, false]);
    });

    it("control: the pipe-delimited form is already a definition (the A2 pin)", () => {
        const lines = "| a | b |\n| --- | --- |\n[^1]: x".split("\n");
        const starts = readNote(lines).labelLines;
        expect(starts[2]).toBe(true);
    });
});
