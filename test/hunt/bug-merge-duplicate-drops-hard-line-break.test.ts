import { describe, expect, it } from "vitest";

import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";

// Bug: merging duplicate definitions trimmed the end of a later copy's
// first line, so two spaces that ended it went, and with them the line
// break they make. In Markdown, two spaces at the end of a line before the
// next line of the same paragraph are a hard line break; without them the
// two lines run together as one.
//
// The note:
//     use[^d] here
//
//     [^d]: first
//
//     [^d]: second··        (two spaces after "second")
//         continued
// "Merge duplicate definitions" on. The second copy's text moves under the
// first, as a continuation, and must keep its two spaces.
//
// Found by the Kimi K3.1 Pro review (2026-11-11); Jason chose to fix it.

describe("merging duplicate definitions keeps a later copy's text as written", () => {
    it("keeps the two spaces that make a hard line break", () => {
        const input = "use[^d] here\n\n[^d]: first\n\n[^d]: second  \n    continued";
        expect(mergeDuplicateFootnoteDefinitions(input)).toBe("use[^d] here\n\n[^d]: first\n    second  \n    continued");
    });

    // Characterization: the space after the label is still dropped.
    it("drops the space between the label and the text (as before)", () => {
        const input = "use[^d] here\n\n[^d]: first\n\n[^d]:   second";
        expect(mergeDuplicateFootnoteDefinitions(input)).toBe("use[^d] here\n\n[^d]: first\n    second");
    });
});
