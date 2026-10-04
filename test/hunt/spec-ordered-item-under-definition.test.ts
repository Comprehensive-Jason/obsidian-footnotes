// Imported from the GLM 5.3 Flash cycle 5 hunt of 2026-09-16 (OpenCode worktree); 1 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16 (GLM hunt cycle 5, probed in Reading view): "2. item text" under a definition is the footnote's body ("body 2. item text"), while "1. item" and "- item" start lists outside it; the walker's lazy rule now matches the paragraph walk.
// GLM 5.3 Flash cycle 9 hunt of 2026-09-16 (this worktree); the red test carries it.fails.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION: does a NON-1 ordered item line directly under a footnote
// definition ("2. item text" under "[^1]: body") lazily continue the
// definition's paragraph in Reading view, or start a list?
//
// Two probed facts point at lazy continuation:
// - a NON-1 ordered item does not interrupt a paragraph in Reading view -
//   only a literal "1." or "1)" does (recorded refutation, probed in
//   Reading view; the zero-padded "01." twin was the probed shape);
// - a plain line directly under a column-0 definition is its lazy
//   continuation (RESOLVED SPEC 3, probed 2026-09-16).
// Composed: "2. item text" is plain text to Obsidian, so the footnote's
// body renders "body 2. item text".
//
// But micromark reads the same document the other way round: the GFM
// footnote definition ENDS at "2. item text" and a top-level
// <ol start="2"> renders outside the footnote (probed for this hunt).
// Whether Obsidian's footnote container behaves like its paragraphs (lazy)
// or like micromark's containers (a new block) is not recorded anywhere.
//
// The plugin's own walks disagree, so one of them is wrong whatever the
// ruling: scanDocument's definition state keeps the definition open
// through "2. item text" (blockEnder does not list it, so an indented
// chunk after the next blank line stays LIVE definition content), while
// findDefinitionBlocks' lazyContinuation ends the block at it (its
// `\d{1,9}[.)]` arm) - so move-to-bottom strands the line and the body
// text leaves the footnote. paragraphGoesOn's own comment states the
// probed rule ("an ordered item not numbered 1 ... carries the paragraph
// on"), contradicting lazyContinuation in the same file.
//
// NEEDS A LIVE CHECK: does "[^1]: body\n2. item text" render footnote 1's
// body as "body 2. item text" in Reading view, or is "2. item text" a
// list outside the footnote?
//
// Source of truth: the probed non-1 interruption refutation + RESOLVED
// SPEC 3 vs micromark's container reading (probed for this hunt);
// Obsidian unprobed for the composite.
// Settings involved: `Move definitions to the bottom` (default ON).

describe("spec: a non-1 ordered item line under a definition", () => {
    it.fails("the block walker owns the item line the reading's own state calls definition content", () => {
        const doc = "text[^1] here\n\n[^1]: body\n2. item text";
        const lines = doc.split("\n");
        const reading = readNote(lines);
        // the reading's own definition state stays open through the item line,
        // so an indented chunk after the next blank is live definition
        // content, not code...
        expect(reading.protectedLines[5]).toBe(false);
        // ...and the block walker must own the line it lives in
        expect(readNote(lines).blocks.map((b) => [b.start, b.end])).toEqual([[2, 3]]);
    });

    it("both walks agree now: the block runs through the item line and the chunk after the blank", () => {
        const doc = "text[^1] here\n\n[^1]: body\n2. item text\n\n    chunk";
        const lines = doc.split("\n");
        const reading = readNote(lines);
        // line 5 is the indented chunk: live definition content per the
        // reading, while findDefinitionBlocks ended the block at line 2 - the
        // two walks disagree, which is the inconsistency above
        expect(reading.protectedLines[5]).toBe(false);
        expect(readNote(lines).blocks.map((b) => [b.start, b.end])).toEqual([[2, 5]]);
    });

    it("control: a literal 1. item DOES end the block (both walks agree)", () => {
        const doc = "text[^1] here\n\n[^1]: body\n1. item text\n\n    chunk";
        const lines = doc.split("\n");
        const reading = readNote(lines);
        expect(readNote(lines).blocks.map((b) => [b.start, b.end])).toEqual([[2, 2]]);
        // "1. item" interrupts, so the reading's own definition state closed
        // too: the chunk after the blank continues the LIST item, and no
        // footnote definition is open for it
        expect(reading.protectedLines[5]).toBe(false);
        expect(readNote(doc.split("\n")).blocks.every((b) => b.end < 3)).toBe(true);
    });
});
