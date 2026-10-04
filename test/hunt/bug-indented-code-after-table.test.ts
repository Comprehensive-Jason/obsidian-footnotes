// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 4 of 6 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";

import { readNote } from "../../src/parsing/note-reading";

// A GFM table is a leaf block: it cannot be continued, lazily or
// otherwise, so the line after its last row starts a NEW block. An
// indented chunk there opens at a block boundary, which makes it
// CommonMark indented CODE - reference-shaped text inside it is dead.
//
// The plugin's own scanner agrees everywhere else: blockBoundary opens
// after "a '#' heading, a closed fence, a bare region closer, or a
// thematic break" (markdown-scan.ts, case C21). And it agrees for the
// LABEL rule: definitionStartLines ends the block at a table row so a
// label directly under a table is a definition (Jason's ruling A2,
// 2026-09-15, pinned). But the indented-code half never learned about
// tables: after "| --- |" the scanner still thinks a paragraph is open,
// so the chunk reads as a lazy paragraph continuation and the [^1]
// inside it is LIVE.
//
// What the user sees: the dead [^1] reserves a number (their next real
// footnote skips one), the missing-definition alert nags about text that
// is sitting inside a code block, and with `Delete orphaned references`
// ON the lint cuts the [^1] OUT of the code block - Jason's ruling
// 2026-08-10 is "lint never touches code", and it does.
//
// Source of truth: GFM's table extension (a table is a leaf block that
// breaks at the start of another block-level structure; an indented
// chunk after it is indented code) + the plugin's own table-row handling
// in readNote(the A2 ruling: the row ends the block).labelLines.
// Residual uncertainty about Reading view's exact table+cache behavior
// is noted; the internal inconsistency (label rule vs indent rule
// disagreeing) is visible either way.
//
// Settings involved: `Delete orphaned references` for the destructive
// half; the default numbering and alerts for the rest.

const doc = "| a |\n| --- |\n    code[^1]\n\nafter";

describe("an indented chunk directly after a table", () => {
    it("is indented code: the table is a leaf block, so the chunk opens at a block boundary", () => {
        expect(readNote(doc.split("\n")).protectedLines[2]).toBe(true);
    });

    it("reserves no footnote number", () => {
        // with the [^1] dead, the next free number is 1
        expect(computeNextFootnoteNumber(doc)).toBe(1);
    });

    it("orphan deletion never cuts text out of the code block", () => {
        expect(removeOrphanedFootnoteReferences(doc)).toBe(doc);
    });

    it("control: the same chunk after a PARAGRAPH line is a live lazy continuation", () => {
        expect(readNote("para\n    code[^1]\n\nafter".split("\n")).protectedLines[1]).toBe(false);
    });

    it("control: the same chunk after a blank line is code today", () => {
        expect(readNote("para\n\n    code[^1]\n\nafter".split("\n")).protectedLines[2]).toBe(true);
    });

    it.fails("a definition under a table keeps its OWN continuation lines: the block walker and the reference scan agree", () => {
        // the [^12] label is a definition (A2); its indented continuation
        // lines belong to it even across a blank. The block walker says so
        // (findDefinitionBlocks) but scanDocument's inDefinition tracking
        // never saw the label as a definition, so the continuation after
        // the blank is read as indented code: the [^22] in it is dead to
        // the reference scan while its twin in the other block is live,
        // and orphan deletion eats one [^22] and keeps the other.
        const doc =
            "[^21]: first\n    continuation\n\n    second para[^22]\n\n" +
            "| a | b |\n| --- | --- |\n| c[^12] | d |\n[^12]: def\n    continuation\n\n    second para[^22]";
        const lines = doc.split("\n");
        expect(readNote(lines).protectedLines[13]).toBe(false);
        expect(removeOrphanedFootnoteReferences(doc)).toBe(
            "[^21]: first\n    continuation\n\n    second para\n\n" +
            "| a | b |\n| --- | --- |\n| c[^12] | d |\n[^12]: def\n    continuation\n\n    second para",
        );
    });
});
