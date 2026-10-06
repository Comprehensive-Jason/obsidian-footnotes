import { describe, expect, it } from "vitest";

import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// BUG: deleting an orphan definition under "> closing words[^1]" followed by
// "> ---" leaves a pair that renders as a blockquoted H2.
// Hunt: 2026-08-09. Lens: contexts.
// Root cause: the pinned setext fix's adjacency regex can't match "> ---".

describe("fixed 2026-08-10: orphan deletion and setext headings inside a blockquote", () => {
    // Since the prose-label rule (2026-09-09) the label directly under the
    // quote line is lazy paragraph text, so the shape this pinned cannot be
    // built any more: nothing is deleted. The lazy line's "[^9]" is a live
    // reference (to nothing) and is renumbered in appearance order; the
    // line stays between the quote and its "> ---".
    it("a label directly under the quote line is prose: nothing is deleted", () => {
        const input = [
            "> closing words[^1]",
            "[^9]: orphan",
            "> ---",
            "",
            "[^1]: used",
        ].join("\n");
        expect(reindexFootnotes(removeOrphanedFootnoteDefinitions(input))).toBe(
            input.replace("[^9]: orphan", "[^2]: orphan"),
        );
    });
});
