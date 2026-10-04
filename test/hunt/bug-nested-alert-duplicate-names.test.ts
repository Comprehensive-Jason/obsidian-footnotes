import { describe, expect, it } from "vitest";

import { nestedFootnoteDefinitionNames } from "../../src/linting/lint-alerts";
import { normalizeEol } from "../../src/parsing/line-edits";

// BUG, annoyance (hunt 2026-08-25, properties lens; skeptic-confirmed):
// nestedFootnoteDefinitionNames returns one entry per definition BLOCK
// with no seen-Set, unlike its siblings (duplicateFootnoteDefinitionNames,
// orphanedFootnoteDefinitionNames), which dedupe case-folded. A name
// defined twice where both copies carry nesting comes back ["z","z"],
// and the Notice tells the user nesting exists in "2 footnote
// definitions ([^z], [^z])" - one real problem inflated by an unrelated
// duplicate-definition problem, and a wasted slot in the
// at-most-three-names list.

describe("nested-footnote alert vs duplicate definitions of one name", () => {
    it("the alert lists each nested NAME once, like its sibling alerts", () => {
        const doc =
            "text with no reference to z anywhere.\n\n[^z]: contains ^[an inline note] here\n[^z]: second copy also nested [^w]\n\n[^w]: w body";
        const lines = normalizeEol(doc).text.split("\n");
        expect(nestedFootnoteDefinitionNames(lines)).toEqual([
            "z",
        ]);
    });
});
