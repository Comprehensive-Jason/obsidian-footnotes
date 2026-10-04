// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";

import { readNote } from "../../src/parsing/note-reading";

// A blank line inside a blockquote (">" with nothing after it) ends the
// quote's open block: a lazy continuation cannot cross a blank line, and
// the blank-quote-line branch in scanDocument says so itself ("a blank
// '>' line is a block boundary inside the quote"). So a column-0 line
// after it starts a NEW block at the document level, and an indented
// chunk there is CommonMark indented CODE - reference-shaped text inside
// it is dead. Verified against micromark: "> quote\n>\n    code[^1]"
// parses as blockquote(paragraph) + code.
//
// The scanner's quote.boundary records the boundary INSIDE the quote, but
// the document-level blockBoundary is never set by the blank quote line,
// so the chunk reads as a lazy paragraph continuation and its [^1] is
// LIVE. (A truly blank line does set blockBoundary, which is why
// "> quote\n\n    code" is already handled.)
//
// What the user sees: the dead [^1] reserves a number (their next real
// footnote skips one), the missing-definition alert nags about code text,
// and with `Delete orphaned references` ON the lint cuts the [^1] OUT of
// the code block - and "lint never touches code" (Jason's ruling
// 2026-08-10).
//
// Source of truth: CommonMark's lazy-continuation rule (a paragraph
// cannot be lazily continued across a blank line) via micromark as run
// for this hunt + the scanner's own comment for the blank-quote branch.
//
// Settings involved: `Delete orphaned references` for the destructive
// half; the default numbering and alerts for the rest.

const doc = "> quote\n>\n    code[^1]\n\nafter";

describe("an indented chunk at column 0 directly after a blank quote line", () => {
    it("is indented code (the blank quote line ended the quote's block)", () => {
        expect(readNote(doc.split("\n")).protectedLines[2]).toBe(true);
    });

    it("reserves no footnote number", () => {
        expect(computeNextFootnoteNumber(doc)).toBe(1);
    });

    it("orphan deletion never cuts text out of the code block", () => {
        expect(removeOrphanedFootnoteReferences(doc)).toBe(doc);
    });

    it("control: the same chunk after a TRULY blank line is already code", () => {
        expect(readNote("> quote\n\n    code[^1]\n\nafter".split("\n")).protectedLines[2]).toBe(true);
    });

    it("the same chunk after a quote line with TEXT is code too (Reading view, not CommonMark's lazy rule)", () => {
        // Obsidian renders a code block here as well (probed 2026-09-16),
        // so the pin's original control, which expected a live lazy
        // continuation, went the other way
        expect(readNote("> quote\n> more\n    code[^1]\n\nafter".split("\n")).protectedLines[2]).toBe(true);
    });
});
