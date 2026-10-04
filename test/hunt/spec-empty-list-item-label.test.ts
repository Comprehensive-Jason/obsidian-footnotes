// Imported from the glm-cycle-11 hunt of 2026-09-16 (OpenCode worktree); confirmed and fixed 2026-09-16.
// PROBED 2026-09-16 (GLM hunt cycle 11): "-" over "[^3]: real definition" renders an empty item and the footnote, with or without a blank line between, so an empty list item is a boundary in the label pass.
// GLM 5.3 Flash cycle 11 hunt of 2026-09-16 (OpenCode worktree glm-cycle-11). 1 of 2 tests carries it.fails; the control does not.
import { describe, expect, it } from "vitest";


import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION: does an EMPTY list item ("- ", no text) end at a column-0
// label line, the way every other list item does when the paragraph it holds
// runs out?
//
//     -
//     [^3]: real definition
//
// The plugin reads the label as LAZY paragraph text: definitionStartLines
// treats the bare "-" as an open paragraph (its walk falls through to open =
// "paragraph" for any non-blank, non-block line, and a lone "-" is neither a
// heading, a rule, nor a setext underline without a paragraph above), so the
// label under it lands in the prose-label rule (manual sheet 14: "a label
// directly under a line of prose (paragraph text, a list item, a quote
// line, ...) is lazy"). The scan's own block walker disagrees in spirit: it
// opens a LIST ITEM container on the bare "-" (listStack gains the item's
// content column), and lazyContinuation says a bare "-" starts a block, not
// a continuation - the two readings of the same line.
//
// CommonMark's lazy-continuation mechanics side against the plugin here: a
// paragraph can only be continued lazily while one is OPEN, and an empty
// list item holds no paragraph - so the list ends at the label line and
// "[^3]: real definition" starts a block, a definition (micromark: list >
// listItem(empty), then footnoteDefinition(3) at the root; the recorded
// probe in bug-definition-starts-misses-block-enders also notes "the setext
// reading beats the empty-list-item reading" - but with no paragraph above,
// no setext reading is available to beat it).
//
// Filing as a spec question rather than a bug: the recorded prose-label rule
// says "a list item" without distinguishing an empty one, and the recorded
// probe shapes ("- item[^91]" with the label INDENTED into the item) all had
// text on the item line. Only a Reading-view probe of the empty-item
// spelling can settle it.
//
// What hangs on the answer: with the lazy reading, the missing-definition
// alert tells the user to add a blank line above a label that (under the
// CommonMark reading) already renders; with the definition reading, the
// orphan and missing-definition alerts must see the definition they
// currently cannot.
//
// Settings involved: the lint alerts and fix-lazy inherit the answer.

function startsOf(doc: string): boolean[] {
    const lines = doc.split("\n");
    return readNote(lines).labelLines;
}

describe("a column-0 label under an EMPTY list item", () => {
    it("starts a definition when Reading view ends the empty item there", () => {
        expect(startsOf("-\n[^3]: real definition")).toEqual([false, true]);
    });

    it("control: a label under a list item WITH text reads lazy (the recorded rule)", () => {
        const doc = "- item\n[^3]: under the item";
        const lines = doc.split("\n");
        const starts = startsOf(doc);
        expect(starts).toEqual([false, false]);
        expect(
            lazyDefinitionLabelNames(lines),
        ).toEqual(["3"]);
    });
});
