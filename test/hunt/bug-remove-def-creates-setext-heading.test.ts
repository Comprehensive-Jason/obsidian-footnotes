import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// BUG (turns body prose into an h2): "prose\n---" is a setext H2. Removing or
// moving the definition line(s) that sat between a paragraph line and a "---"
// (or "___" / "***") line drops the paragraph directly onto the divider,
// silently rewriting it into a heading. Both removeLineRanges (used by reindex's
// orphan cut and by move-to-bottom) and move-to-bottom's re-layout only collapse
// doubled blank lines; neither checks what its cut leaves adjacent.
// Scenario: cutting/moving a definition strands a paragraph atop a "---" -> setext heading.
// fixed 2026-07-17: removeLineRanges reinstates a blank line when a cut would
// drop a paragraph directly onto a "---"/"===" setext underline.
// Provenance: iteration-1/eval-0/without_skill/run-1 (transform bug hunt, Bug 2).

describe("bug: removing definition lines can silently create a setext heading", () => {
    // Since the prose-label rule (2026-09-09) a label directly under a prose
    // line is lazy paragraph text, so the hazard these two pinned - a
    // definition deleted or moved from BETWEEN a paragraph line and "---",
    // leaving the pair that reads as a setext heading - can no longer be
    // built: such a label is not a definition, so nothing is deleted or
    // moved. Its "[^9]" IS a live reference (to nothing), and reindex
    // renumbers it in appearance order like any other; the line itself stays.
    it("a label directly under the paragraph is prose: drop-orphans deletes nothing", () => {
        const input = "closing words[^1]\n[^9]: orphan\n---\n\n[^1]: def";
        expect(reindexFootnotes(removeOrphanedFootnoteDefinitions(input))).toBe(
            "closing words[^1]\n[^2]: orphan\n---\n\n[^1]: def",
        );
    });

    it("a label directly under the paragraph is prose: move-to-bottom moves nothing", () => {
        const input = "para one[^1] here\n[^1]: def\n---\npara two";
        expect(moveFootnoteDefinitionsToBottom(input)).toBe(input);
    });

    it("with the blank line that makes it a definition, the orphan goes and no setext pair forms", () => {
        const input = "closing words[^1]\n\n[^9]: orphan\n---\n\n[^1]: def";
        const out = reindexFootnotes(removeOrphanedFootnoteDefinitions(input));
        expect(out).not.toContain("closing words[^1]\n---");
        expect(out).not.toContain("[^9]");
    });
});
