import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// Sol re-review bug #4 (2026-08-10), ground truth verified against
// Obsidian's metadataCache ("blockquote:0-1, paragraph:3-3"): an unclosed
// "$$" or "<!--" opened INSIDE a blockquote dies with its quote - but the
// scanner's comment/math state had no container tracking (fences got it
// in f84e96b), so everything after the quote was protected to EOF and
// invisible to every reading. Comment/math regions now record the blockquote
// depth they opened at and end when a line's depth drops below it.

describe("unclosed comment/math regions die with their blockquote", () => {
    it("a quoted unclosed $$ ends at the quote's end", () => {
        // the "$$" line is part of the display math block, as a fence's
        // own line is part of its code block (the note reading, runtime
        // swap step 2, 2026-10-03; the scanner kept the opener line live)
        const doc = "> $$\n> x = 1\n\nafter[^1]\n\n[^1]: def";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([
            true,
            true,
            false,
            false,
            false,
            false,
        ]);
    });

    it("a quoted unclosed <!-- ends at the quote's end", () => {
        // the opener line is dead too since 2026-09-15: a comment opened
        // at the start of a line (or of a quote's content) is an HTML block
        const doc = "> <!--\n> draft\n\nafter[^1]";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([
            true,
            true,
            false,
            false,
        ]);
    });

    it("an unquoted line does NOT end a quoted $$ block (rule B4)", () => {
        // Corrected in step 2 of the runtime swap (2026-10-03): CommonMark
        // keeps lazy continuation for paragraphs, but Obsidian's parser
        // runs fences, "$$" blocks, and HTML blocks inside quotes and items
        // on through column-0 lines (rule B4, docs/obsidian-reading-rules.md,
        // held to Obsidian's saved answers by the referee)
        const doc = "> $$\nlazy[^1]";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([true, true]);
    });

    it("a document-level unclosed region still protects to EOF", () => {
        const doc = "$$\nx\n\nswallowed[^1]";
        const reading = readNote(doc.split("\n"));
        expect(reading.protectedLines).toEqual([true, true, true, true]);
        expect(reading.openRegionFrom !== -1).toBe(true);
    });

    it("a quoted unclosed region does not protect an EOF append", () => {
        const reading = readNote("> $$\n> x".split("\n"));
        expect(reading.openRegionFrom !== -1).toBe(false);
    });
});
