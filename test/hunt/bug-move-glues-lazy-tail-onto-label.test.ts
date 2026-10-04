// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// REVISED 2026-09-16 (GLM hunt cycle 3, probed in Reading view): a label directly under a definition's lazy continuation line renders as a definition after all, so the glued shape never demoted the second footnote in Obsidian; the plugin's own reading did, and definitionStartLines now keeps the definition open through its lazy line. The blank line the move keeps is harmless and stays, so these tests still pass.
import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

import { readNote } from "../../src/parsing/note-reading";

// A definition block ends with its lazy continuation line when a plain
// line sits directly under the label ("[^1]: one" then "lazy tail" -
// Reading view renders one footnote "one lazy tail"; the block walker owns
// the tail, pinned 2026-09-16). Move-to-bottom gathers the blocks by
// joining them with a single "\n", so a block ending in such a tail lands
// DIRECTLY above the next definition's label: "lazy tail\n[^2]: two".
// Sheet 14's own rule then reads the second label as lazy paragraph text
// (a label directly under a paragraph line is no definition), so the
// second footnote stops rendering. The pipeline even fights itself over
// it: fix-lazy inserts the blank back, and move-to-bottom re-glues the
// pair in the very same pass - the note settles with the definition
// demoted, every lint, forever.
//
// What the user sees: they had two working footnotes; after one lint the
// second one no longer renders, and the next lint's lazy-definition alert
// tells them to add the blank line the lint itself keeps removing.
// Conservation (definitions and references survive a lint with every
// deletion off) is broken: 2 definitions become 1. Found by the
// conservation property with the cycle-3 generator shapes (a pipe-less
// GFM table whose label's lazy tail is "c | d").
//
// Source of truth: sheet 14 (the label-under-prose rule the move's
// OUTPUT now violates) + the conservation promise of former sheets 20/21 (lint
// never changes what renders, with deletions off) + the pinned
// lazy-continuation ruling (the tail belongs to the first block, so the
// only place left to be wrong is the join).
//
// Settings involved: `Move definitions to the bottom` (default ON); the
// full lint shows the fix-lazy/move fight.

const defs = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).blocks.map((b) => b.name);
};

const DOC = "para[^1][^2]\n\n[^1]: one\nlazy tail\n\n[^2]: two\n\nmore prose";

describe("move-to-bottom glues a lazy-tailed block onto the next label", () => {
    it("the moved note keeps [^2] a live definition (a blank separates them)", () => {
        expect(defs(moveFootnoteDefinitionsToBottom(DOC))).toEqual(["1", "2"]);
    });

    it("the full lint conserves both definitions (2 before, 2 after)", () => {
        expect(defs(lintFootnotes(DOC, {}))).toEqual(["1", "2"]);
    });

    it("the linted note's second label is not lazy", () => {
        const out = lintFootnotes(DOC, {});
        const lines = out.split("\n");
        const starts = readNote(lines).labelLines;
        expect(lines.filter((_line, i) => lines[i] === "[^2]: two" && starts[i])).toHaveLength(1);
    });

    it("control: a block ending with an INDENTED continuation packs safely (a label under it starts)", () => {
        const doc = "para[^1][^2]\n\n[^1]: one\n    indented tail\n\n[^2]: two\n\nmore prose";
        expect(defs(moveFootnoteDefinitionsToBottom(doc))).toEqual(["1", "2"]);
    });

    it("control: label-last blocks keep packing with no blank between (sheet-20 layout)", () => {
        const moved = moveFootnoteDefinitionsToBottom("para[^1][^2]\n\n[^1]: one\n\n[^2]: two\n\nmore prose");
        expect(moved).toBe("para[^1][^2]\n\nmore prose\n\n[^1]: one\n[^2]: two");
    });
});
