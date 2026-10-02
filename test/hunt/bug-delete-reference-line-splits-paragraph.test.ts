import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// BUG (wrong output): cutting a reference that stands alone on a line
// inside a paragraph splits the paragraph in two.
//
// What the user would see: a paragraph runs over three lines, "one",
// "[^1]" and "three", and Reading view shows them as one paragraph. Delete
// footnote everywhere on footnote 1 leaves an empty line in the middle,
// so "one" and "three" are now two separate paragraphs.
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D4.
//
// Source of truth: CommonMark, checked with micromark: "one\n[^1]\nthree"
// is one paragraph, "one\n\nthree" is two. A delete removes the footnote
// and should leave the text around it reading as it did.
//
// Cause: cutOne empties the line but keeps it, and an empty line ends a
// paragraph.

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("a reference alone on a line inside a paragraph", () => {
    it.fails("does not split the paragraph in two when it is cut", () => {
        const out = md(["one", "[^1]", "three", "", "[^1]: x"], "1");
        expect(out).not.toBe("one\n\nthree");
    });
});
