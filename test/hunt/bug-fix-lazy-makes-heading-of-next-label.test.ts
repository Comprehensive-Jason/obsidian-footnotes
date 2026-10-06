import { describe, expect, it } from "vitest";

import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): with two lazy labels in one paragraph and a "==="
// under the second, the fix-lazy rule fixes the first and turns the second
// into a heading.
//
// What the user would see: "Text[^1]", "[^1]: a", "[^2]: b", "===", with
// no blank lines between them. Reading view draws one paragraph, with the
// "===" as plain text at its end. On Ctrl+S, the rule "Fix definitions
// hidden by a missing blank line" puts a blank line above "[^1]: a". Now
// [^1] is a definition, and right under it "[^2]: b" over "===" reads as
// a big level 1 heading "2: b". The note had no heading; now it has one
// the user never wrote, and [^2] still has no definition.
//
// A "lazy label" is a "[^1]:" line directly under a line of prose, one
// blank line short of being a definition, so Obsidian reads it as more of
// the paragraph. A "setext heading" is a line of text with a line of "="
// or "-" marks under it, which Obsidian draws as a heading.
//
// Hunt 2026-10-06, cycle 5, lens reader. Cluster X37.
//
// Origin: pre-existing.
//
// Source of truth: docs/obsidian-reading-rules.md D3 ("[^1]: def" over
// "===" turns the label line into a heading; under a continuation line,
// "===" is lazy text); the note reading agrees on both notes (the counts
// below). The precedent bug-remove-def-creates-setext-heading
// (2026-07-17) ruled that changing a note's heading structure behind the
// user's back is a defect.
//
// Cause: linesAfterReadDifferently in
// src/linting/rules/fix-lazy-definitions.ts lets every line that carries
// on the label's paragraph read differently after the blank line goes in,
// since those lines usually become the definition's text, as the user
// meant. Here the lines that carry on are another label and its "===",
// and they become a heading instead, which the check never looks at.

/** The innermost block in one line's entry of the reading's lineBlocks, with its "^" when it starts on that line. */
const ownBlock = (blocks: string | undefined): string => (blocks ?? "").split(" ").pop() ?? "";

/** How many headings start in the note, by the note reading (the plugin's model of how Obsidian reads it). */
const headingLines = (lines: string[]): number => readNote(lines).lineBlocks.filter((blocks) => /^\^heading\d$/.test(ownBlock(blocks))).length;

const Lines = ["Text[^1]", "[^1]: a", "[^2]: b", "===", "", "x[^2]"];

describe("two lazy labels in one paragraph, a '===' under the second", () => {
    it("control: the note has no heading before the fix", () => {
        expect(headingLines(Lines)).toBe(0);
    });

    // Now the result is "Text[^1]", "", "[^1]: a", "[^2]: b", "===", "",
    // "x[^2]", and "[^2]: b" / "===" is a level 1 heading.
    it("fixing the first label does not turn the second into a setext heading", () => {
        const out = fixLazyDefinitions(Lines.join("\n")).split("\n");
        expect(headingLines(out)).toBe(0);
    });
});
