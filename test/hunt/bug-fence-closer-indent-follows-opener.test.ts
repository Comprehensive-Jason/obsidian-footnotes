import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { readNote } from "../../src/parsing/note-reading";

// Scenario: a code fence opened with one space of indent is closed by a line
// indented four spaces, which is too deep to be a closer. Everything after
// it is then treated as ordinary text when it is still code.
//
// What the user would see: in a note that reads
//    ```
//   aaa[^1]
//       ```
//   bbb[^2]
// (the opener carrying one space of indent, the would-be closer carrying
// four) the plugin thinks the code block has ended. So "bbb[^2]" is read as
// a live reference even though Obsidian still shows it as code. Lint will
// renumber and rewrite inside the code block, and creating a new footnote
// hands out 3 instead of 1.
//
// The cause: when a fence opens at the document level, contentIndent is
// computed as the opener's own indent, so the closer is allowed to sit at
// the opener's indent plus three. CommonMark measures those three spaces
// from the document margin, not from the opener.
//
// Hunt: 2026-09-13. Lens: contexts.
//
// Source of truth: CommonMark 0.31.2 section 4.5, "The closing code fence
// may be indented up to three spaces, and its indentation need not match
// that of the opening fence", together with the four-space-closer example
// printed right after it (example 107). Checked against micromark: the
// four-space line stays part of the code block's content.

describe("a closer indented four spaces never closes a document-level fence", () => {
    it("an opener indented one space is not closed by a four-space line", () => {
        const lines = [" ```", "aaa[^1]", "    ```", "bbb[^2]"];
        expect(readNote(lines).protectedLines).toEqual([true, true, true, true]);
    });

    it("so the text after it is still code, and reserves no number", () => {
        expect(computeNextFootnoteNumber(" ```\naaa[^1]\n    ```\nbbb[^2]")).toBe(1);
    });

    it("control: an opener with no indent already refuses that closer", () => {
        expect(readNote(["```", "aaa[^1]", "    ```", "bbb[^2]"]).protectedLines).toEqual([
            true,
            true,
            true,
            true,
        ]);
    });
});
