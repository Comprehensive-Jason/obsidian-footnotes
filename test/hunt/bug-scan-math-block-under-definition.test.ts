import { describe, expect, it } from "vitest";

import { findDefinitionBlocks, scanDocument } from "../../src/parsing/markdown-scan";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (data loss with Delete orphaned definitions on): a "$$" math block
// directly under a definition is taken as part of the footnote, so the
// lint moves it with the footnote or deletes it with an orphan.
//
// What the user would see: "[^1]: body" is followed directly by a math
// block, "$$", "x = 1", "$$". Reading view ends the footnote at the "$$"
// and shows the math in the note. The plugin counts the math block as
// footnote 1's text, so the default lint carries it to the bottom of the
// note with the definition. In a blockquote with an orphaned definition
// ("> [^1]: quoted orphan" over "> $$", "> x = 1", "> $$"), Delete
// orphaned definitions deletes the math block too.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X8.
//
// Source of truth: 2c1b026 (probed in Reading view: a "$$" block directly
// under a definition is a block of its own and ends the definition). A
// "<div>" block in the same place already ends it.

describe("a '$$' math block directly under a definition is a block of its own", () => {
    it.fails("the block walker ends the footnote above the '$$' line", () => {
        const lines = "text[^1]\n\n[^1]: body\n$$\nx = 1\n$$\n\nlast para".split("\n");
        expect(findDefinitionBlocks(lines, scanDocument(lines))).toEqual([{ name: "1", start: 2, end: 2 }]);
    });

    it.fails("quoted twin: deleting a quoted orphaned definition keeps the quoted math block", () => {
        const doc = "text\n\n> [^1]: quoted orphan\n> $$\n> x = 1\n> $$\n\nlast para";
        // Today: "text\n\nlast para" - the math block went with the orphan.
        expect(lintFootnotes(doc, { removeOrphanedDefinitions: true })).toContain("> $$\n> x = 1\n> $$");
    });
});
