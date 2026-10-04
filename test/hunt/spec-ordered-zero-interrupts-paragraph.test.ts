// Imported from the Kimi K3 cycle 4 hunt of 2026-09-16 (OpenCode worktree); 1 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// REFUTED 2026-09-16 (Kimi hunt cycle 4, probed in Reading view): "para" over "01. item" is one paragraph, no list, so only a literal "1." or "1)" interrupts; the plugin's reading stands.
import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// spec question: does an ordered list item numbered "01" (or "001")
// interrupt a paragraph in Obsidian's Reading view?
//
// CommonMark parses the ordered-list start NUMBER as an integer, and the
// rule is that a list can interrupt a paragraph only when that number is
// 1. "01." parses to 1, so in CommonMark "para\n01. item" is a paragraph
// and then a list. The plugin's paragraphGoesOn - the check that decides
// whether a code span or a comment/math region opened in one paragraph
// may close in a later line of it - stops only at a literal "1[.)]" list
// marker, so it lets the span run straight past a "01." line.
//
// The consequence: in "a `code\n01. [^1] x\nspan`" the plugin kills the
// reference (the span covers it) where CommonMark leaves it live (the
// list starts, the span dies with the paragraph). A cross-line comment or
// math region's lookahead has the same shape.
//
// NEEDS A LIVE CHECK: whether Reading view starts a list at "01." under a
// paragraph (Obsidian usually normalizes ordered markers, but whether it
// lets one interrupt a paragraph is not recorded anywhere). If it does,
// the plugin's span/region lookaheads run one line too far.
//
// Source of truth: CommonMark 5.2 (the start number is an integer;
// paragraph interruption turns on its value), against the plugin's
// literal "1[.)]" pattern. micromark is the oracle for the CommonMark
// side only - Obsidian's own reading is the unrecorded half.

describe("spec question: a zero-padded ordered item interrupting a paragraph", () => {
    it("the plugin lets a code span cross a '01.' line (the premise to verify)", () => {
        const masked = [...readNote("a `code\n01. [^1] x\nspan`".split("\n")).maskedLines()];
        expect(masked[1]).not.toContain("[^1]");
    });

    it("REFUTED: Reading view starts no list at '01.' under a paragraph, so the span crosses it and the reference is dead", () => {
        // "para" over "01. item" renders as one paragraph (probed
        // 2026-09-16), so the plugin's literal "1[.)]" test is right
        const lines = "a `code\n01. [^1] x\nspan`".split("\n");
        const masked = [...readNote(lines).maskedLines()];
        expect(masked[1]).not.toContain("[^1]");
    });

    it("control: a literal '1.' item stops the span today", () => {
        const lines = "a `code\n1. [^1] x\nspan`".split("\n");
        const masked = [...readNote(lines).maskedLines()];
        expect(masked[1]).toContain("[^1]");
    });
});
