import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// BUG (data loss): protectedLines/findDefinitionBlocks have no awareness of HTML
// comments, so a definition-shaped line inside a multi-line <!-- --> block is
// treated as a real definition.
//  - move-to-bottom rips "[^9]: hidden note" out of the comment and re-exposes
//    it as a live definition at the bottom.
//  - reindex({ keepOrphanedDefinitions: false }), an option since removed
//    (hunt 2026-10-05 round 2, cluster L7), saw it as an orphan (its
//    "[^9]:" never counts as a reference thanks to AllReferences' (?!:)) and
//    permanently DELETES the commented-out text - silent content loss.
// Scenario: a footnote definition inside an HTML comment is relocated / deleted.
// fixed 2026-07-17: protectedLines treats a multi-line <!-- --> comment as a
// protected region, so findDefinitionBlocks never sees the commented def.
// Provenance: iteration-1/eval-0/with_skill/run-1 (transforms hunt), lens: contexts.

describe("bug: HTML-comment definition mishandled by the transforms", () => {
    const input = [
        "real[^1].",
        "",
        "<!--",
        "[^9]: hidden note",
        "-->",
        "",
        "[^1]: def",
    ].join("\n");

    it("move-to-bottom leaves a commented-out definition inside its comment", () => {
        expect(moveFootnoteDefinitionsToBottom(input)).toBe(input);
    });

    it("the orphan rule and reindex do not delete a commented-out definition", () => {
        expect(
            reindexFootnotes(removeOrphanedFootnoteDefinitions(input)),
        ).toBe(input);
    });
});
