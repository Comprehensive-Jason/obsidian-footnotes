import { describe, expect, it } from "vitest";

import { readNote } from "../../src/parsing/note-reading";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (wrong output on default settings): when a label line is underlined
// with "===", an indented chunk after it is read as footnote text instead
// of code, and the default lint renumbers inside the code.
//
// What the user would see: the line "[^1]: x" is followed by "===". A line
// of "=" under a paragraph is a setext underline (it makes the line above
// a heading), so "[^1]: x" is a heading, not a definition, and the
// footnote's block ends there. An indented chunk after it,
// "    chunk [^9]", is an indented code block (text indented four spaces,
// shown as code). The plugin reads it as footnote 1's body, so the
// default lint renames the "[^9]" in the code to "[^3]". The same happens
// with no blank line between, and inside a blockquote.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X6.
//
// Source of truth: CommonMark 4.3 (a setext underline turns the paragraph
// above into a heading and ends it) and 4.4 (an indented chunk after a
// heading is code), and Jason's 2026-08-10 ruling that text inside code is
// untouchable. The "---" twin is already read correctly.

describe("a setext underline under a label line ends the block (the label is heading text)", () => {
    it("the default lint never rewrites an indented code chunk under a '[^1]: x' / '===' heading", () => {
        const doc = "x[^3]\n\n[^1]: x\n===\n\n    chunk [^9]\n\n[^3]: three";
        // Today: "x[^1]\n\n[^2]: x\n===\n\n    chunk [^3]\n\n[^1]: three".
        expect(lintFootnotes(doc)).toContain("    chunk [^9]");
    });

    it("an indented chunk directly under '[^1]: x' / '===' is code", () => {
        const lines = "[^1]: x\n===\n    chunk [^2]\n\n[^2]: two".split("\n");
        // the "===" is an underline: block syntax through to its end
        expect(readNote(lines).blockSyntaxEnd(1)).toBe(Infinity);
        expect(readNote(lines).protectedLines[2]).toBe(true);
    });

    it("an indented chunk after a blank under '[^1]: x' / '===' is code", () => {
        const reading = readNote("[^1]: x\n===\n\n    chunk [^2]\n\n[^2]: two".split("\n"));
        expect(reading.protectedLines[3]).toBe(true);
    });

    it("quoted: an indented quoted chunk under '> [^1]: x' / '> ===' is code", () => {
        const reading = readNote("> [^1]: x\n> ===\n>     chunk [^2]\n\n[^2]: two".split("\n"));
        expect(reading.protectedLines[2]).toBe(true);
    });
});
