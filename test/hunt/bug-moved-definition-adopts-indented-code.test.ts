import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { lintFootnotes } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";

// Found by the conservation property (2026-09-11) while an unrelated change
// was being checked; it predates that change. A note whose "# Footnotes"
// heading is followed by a standalone indented code chunk:
//
//     [^1]: sees [^1]
//
//     # Footnotes
//
//     <tab>code-shaped[^89]
//
// Move-to-bottom gathered the definition under the heading, which put the
// code chunk directly after the definition's blank line. An indented line
// after a definition's blank gap CONTINUES that definition, so the code
// chunk stopped being code and became footnote body, and the "[^89]"
// inside it, dead as code, woke up as a live reference. The rule moved a
// definition onto a chunk it then swallowed.
//
// Jason's ruling (2026-09-16): the definitions are parked BELOW the code
// chunk, the way they go below any block, so the chunk stays code.

describe("move-to-bottom parks a definition below an indented code chunk, never above it", () => {
    const doc = "[^1]: sees [^1]\n\n# Footnotes\n\n\tcode-shaped[^89]";
    const options = { fixPunctuation: false, fixLazyDefinitions: false, reindex: false, sectionHeading: "# Footnotes" };

    it("the definition lands under the chunk and the chunk stays standalone code", () => {
        const out = lintFootnotes(doc, options);
        expect(out).toBe("# Footnotes\n\n\tcode-shaped[^89]\n\n[^1]: sees [^1]");
        const lines = out.split("\n");
        const reading = readNote(lines);
        expect(reading.protectedLines[2]).toBe(true);
        expect(readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([{ name: "1", start: 4, end: 4 }]);
        // the reference-shaped string inside the code stays dead
        expect(computeNextFootnoteNumber(out)).toBe(2);
    });

    it("a second lint changes nothing", () => {
        const once = lintFootnotes(doc, options);
        expect(lintFootnotes(once, options)).toBe(once);
    });

    it("a chunk of several indented lines with a blank line inside stays whole", () => {
        const wide = "[^1]: sees [^1]\n\n# Footnotes\n\n\tone\n\n\ttwo\n\nTail prose.";
        expect(lintFootnotes(wide, options)).toBe(
            "# Footnotes\n\n\tone\n\n\ttwo\n\n[^1]: sees [^1]\n\nTail prose.",
        );
    });

    it("control: prose under the heading still goes below the definitions", () => {
        const prose = "[^1]: sees [^1]\n\n# Footnotes\n\nTail prose.";
        expect(lintFootnotes(prose, options)).toBe("# Footnotes\n\n[^1]: sees [^1]\n\nTail prose.");
    });
});
