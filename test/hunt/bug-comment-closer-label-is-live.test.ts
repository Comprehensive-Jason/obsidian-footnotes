import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";

import { readNote } from "../../src/parsing/note-reading";

// BUG (review A1, Jason confirmed live 2026-09-08): a definition-shaped
// line that CLOSES an HTML comment ("[^2]: two -->") is not protected as
// a whole - its live suffix after "-->" stays scannable - and
// findDefinitionBlocks matched DefinitionStart against the RAW line, so
// the label inside the comment read as a live definition block.
// Move-to-bottom then dragged the closer line (and the "-->" with it) to
// the bottom of the note, leaving the comment unclosed: everything after
// "<!--" vanished from the rendered note. Micromark parses the fixture as
// paragraph / html / paragraph with no footnoteDefinition at all. Every
// other definition reader already goes through the masked twin
// (definitionLabelWithName); the block walker now does too.

const DOC = [
    "text[^1] here",
    "",
    "<!--",
    "[^1]: one",
    "[^2]: two -->",
    "",
    "tail",
].join("\n");

describe("a definition label on a comment closer line is not a definition block", () => {
    it("findDefinitionBlocks sees no block on the closer line", () => {
        const lines = DOC.split("\n");
        expect(readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([]);
    });

    it("the lint leaves the commented-out definitions where they are", () => {
        // every definition is inside the comment, so nothing is live: the
        // rules have nothing to move, renumber, or swap
        expect(lintFootnotes(DOC)).toBe(DOC);
    });
});
