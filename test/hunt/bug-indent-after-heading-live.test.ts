import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// Sol re-review bug #5 (2026-08-10), ground truth verified against
// Obsidian's metadataCache ("heading:0-0, code:1-1"): lazy continuation
// only applies to PARAGRAPHS - after an ATX heading, a closed fence, or a
// thematic break, an immediately following 4-space chunk IS indented code
// even with no blank line between. The scanner's block-boundary flag was
// blank-line-only, so lint rewrote inside what Obsidian renders as code.

describe("indented chunks after non-paragraph blocks are code", () => {
    it("after an ATX heading", () => {
        const doc = "# Title\n    code[^9]\n\nafter\n\n[^9]: def";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([
            false,
            true,
            false,
            false,
            false,
            false,
        ]);
    });

    it("after a closed fence", () => {
        const doc = "```\nf\n```\n    chunk[^9]";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([
            true,
            true,
            true,
            true,
        ]);
    });

    it("after a thematic break", () => {
        const doc = "x\n\n---\n    code[^9]";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([
            false,
            false,
            false,
            true,
        ]);
    });

    it("after a bare multi-line comment closer", () => {
        // the opener and closer lines of a comment that opens at the start
        // of a line are dead too: it is an HTML block (2026-09-15)
        const doc = "<!--\nhidden\n-->\n    chunk[^9]";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([
            true,
            true,
            true,
            true,
        ]);
    });

    it("a paragraph's lazy indented continuation stays live", () => {
        expect(readNote("para\n    lazy[^1]".split("\n")).protectedLines).toEqual([
            false,
            false,
        ]);
    });

    it("a definition's indented continuation stays live", () => {
        expect(readNote("[^1]: x\n    cont[^2]".split("\n")).protectedLines).toEqual([
            false,
            false,
        ]);
    });
});
