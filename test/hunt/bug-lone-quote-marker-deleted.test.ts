import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

// BUG (annoyance): a line holding only ">" next to the definitions at the
// end of a note is deleted by the lint, and two lints in a row do not give
// the same note.
//
// What the user would see: "Text[^1]", then "[^1]: def", then a line with
// only ">" at the end of the note (as typed to start a quote). The first
// save moves the definition below the ">". The second save, with nothing
// typed in between, deletes the ">" line. When the definition is already
// below the ">", the first save deletes it.
//
// A ">" is a quote marker: a line holding only ">" is an empty quote,
// which Obsidian shows as an empty quote box.
//
// Hunt 2026-10-06, cycle 4, lens lint. Cluster L4.
//
// Origin: pre-existing.
//
// Source of truth: the lint's promise that one run settles a note
// (lintNote's doc in src/linting/linter.ts), and that it deletes no text
// of the user's beyond what a rule names.
//
// Cause: removeLineRanges, which the move-to-bottom rule uses to take the
// definitions out, pops every trailing blank quote line when its cut
// reaches the end of the note. A lone ">" is a whole empty quote, not a
// blank line inside a quote with text, but it is popped all the same.

describe("a lone '>' line next to the definitions", () => {
    // Now: the first lint gives "Text[^1]", "", ">", "", "[^1]: def"; the
    // second deletes the ">".
    it("the default lint is idempotent on a note ending in a lone '>'", () => {
        const doc = "Text[^1]\n\n[^1]: def\n\n>";
        const once = lintFootnotes(doc, {});
        expect(lintFootnotes(once, {})).toBe(once);
    });

    // Now: "Text[^1]", "", "[^1]: def", the ">" gone.
    it("move-to-bottom keeps a lone '>' line when the definitions are already at the bottom", () => {
        const doc = "Text[^1]\n\n>\n\n[^1]: def";
        expect(moveFootnoteDefinitionsToBottom(doc, "").split("\n")).toContain(">");
    });
});
