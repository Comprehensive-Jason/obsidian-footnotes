import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";

import { readNote } from "../../src/parsing/note-reading";

// Scenario: a label sitting directly under a prose line is not a definition,
// it is paragraph text, but the scan still counts it as an open definition,
// and a four-space-indented "```" underneath then opens a code fence that
// never closes.
//
// What the user would see: in a note that reads
//   prose
//   [^1]: lazy label
//       ```
//   live[^9] text
// everything from the label down is treated as protected text. Footnote
// commands refuse to work there with a protected-text toast, lint leaves
// that whole stretch alone, and creating a new footnote hands out the number
// 2 instead of 10, because the real reference "[^9]" further down has become
// invisible. The note looks perfectly ordinary on screen.
//
// The cause: scanDocument sets its "am I inside a definition?" flag from the
// raw DefinitionStart regex, which only asks whether the line begins with a
// label. It does not apply the prose-label rule that the rest of the plugin
// uses. Inside a definition a "    ```" IS a real fence, since a
// definition's continuation lines start at column four, so the wide-fence
// branch fires and opens a fence with nothing to close it.
//
// The same flag also feeds opensCommentBlock, so a "    %%" under a lazy
// label is suspect by exactly the same route. That one has not been
// verified.
//
// Hunt: 2026-09-13. Lens: contexts.
//
// Source of truth: manual sheet 14, which rules that a label under a prose
// line is paragraph text (ruling 2026-09-09); CommonMark 0.31.2 sections 4.4
// and 4.5, where a delimiter indented four columns after a paragraph line is
// lazy continuation of that paragraph and not a fence at all. Checked
// against micromark: the whole run parses as one paragraph, with no code
// block in it.

const lines = ["prose", "[^1]: lazy label", "    ```", "live[^9] text"];

describe("a lazy label must not open a four-space fence", () => {
    it("no line in the note is protected", () => {
        expect(readNote(lines).protectedLines).toEqual([false, false, false, false]);
    });

    it("the note does not end inside protected text", () => {
        expect(readNote(lines).openRegionFrom !== -1).toBe(false);
    });

    it("the reference after the four-space run still reserves its number", () => {
        expect(
            computeNextFootnoteNumber("prose\n[^1]: lazy label\n    ```\nlive[^9] text"),
        ).toBe(10);
    });
});
