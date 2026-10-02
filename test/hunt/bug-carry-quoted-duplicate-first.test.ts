import { describe, expect, it } from "vitest";

import { carriedDefinitions } from "../../src/commands/carry-footnotes";

// BUG (wrong output): when a footnote is defined twice, first inside a
// blockquote and then again at the start of a line further down, copy
// carries the FIRST definition, which Obsidian does not show.
//
// What the user would see: the note has "> [^d]: quoted first" and,
// below it, "[^d]: plain last". Reading view shows "plain last" for the
// footnote. They copy a sentence holding "[^d]" and paste it into another
// note, and the footnote arrives saying "quoted first".
//
// Hunt 2026-10-02, round 1, lens carry-sel. Cluster C5.
//
// Source of truth: the docstring of carriedDefinitions: "Of duplicate
// definitions the LAST is carried, the one Obsidian renders."
//
// Cause: carriedDefinitions collects the column-0 definition blocks
// (those whose label starts the line) first and the quoted ones
// (blockquote "> [^d]:") after them, and never sorts the list by line.
// So the "last" block it picks is the last QUOTED one, wherever it sits.
// planCarriedPaste sorts the same kind of list by line; this one does
// not.

/** carriedDefinitions on a note given as lines. */
const carry = (lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) =>
    carriedDefinitions(lines.join("\n"), from, to);

describe("a footnote defined in a blockquote first and at column 0 last", () => {
    it.fails("of a quoted duplicate FIRST and a column-0 duplicate LAST, the last in the document is carried", () => {
        expect(carry(["a[^d]", "", "> [^d]: quoted first", "", "[^d]: plain last"], { line: 0, ch: 0 }, { line: 0, ch: 5 }).carried).toEqual([
            { name: "d", lines: ["[^d]: plain last"] },
        ]);
    });
});
