import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// spec question: when a delete empties a numbered list item right under a
// paragraph, should it guard against the "1." folding into the paragraph?
//
// What it does now: "Sources:" over "1. [^1]" becomes "Sources:" over
// "1.", and "Notes:" over "1. [^i]: defined in the list" becomes "Notes:"
// over "1. ". micromark reads both results as one paragraph, "Sources: 1."
// and "Notes: 1.": the list is gone and the "1." is text at the end of the
// sentence above.
// What a user might expect: the empty item is removed whole, or the
// delete refuses, as the bullet twin should (bug-delete-reference-bullet-
// leaves-heading, bug-delete-marker-line-definition-leaves-heading).
// Why it is a question and not a bug: needs a Reading-view check. Only
// micromark has been asked; whether Obsidian also folds an empty "1."
// into the paragraph above has not been probed, and Jason's db29b09
// ruling ("the bullet stays") was made for items inside a list.
//
// Hunt 2026-10-02, round 2, lens delete. Clusters D3 and D5 (the ordered
// variants).
//
// Source of truth: CommonMark 5.2 (an empty list item cannot interrupt a
// paragraph), checked with micromark.
//
// The first case is answered (Jason's ruling B11, 2026-10-08, stage 3 of
// the result gate design): the result gate refuses the delete, since the
// "1." would stop being a list item, and nothing is deleted; it was
// it.fails until then. The second, a definition on the marker's line, is
// still open: the gate compares a definition's lines wherever they sit, not
// as the lines around a cut, so it lets the item fold.

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("spec question: an ordered item emptied by a delete under a paragraph", () => {
    it("cutting a reference that is an ordered item's whole content does not fold the item into the paragraph: the delete is refused", () => {
        expect(md(["Sources:", "1. [^1]", "", "[^1]: x"], "1")).toBe("<<refused>>");
    });

    it.fails("emptying a numbered marker-line definition does not fold the item into the paragraph", () => {
        expect(md(["Notes:", "1. [^i]: defined in the list", "", "p[^i]"], "i")).not.toBe("Notes:\n1. \n\np");
    });
});
