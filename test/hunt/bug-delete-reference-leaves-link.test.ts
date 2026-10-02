import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// BUG (wrong output): cutting a reference that sits between "]" and "("
// glues the two together into a link.
//
// What the user would see: the line reads "see [Smith][^1](2020) here",
// which Reading view shows as "[Smith]", footnote 1, then "(2020)". Delete
// footnote everywhere on footnote 1 leaves "see [Smith](2020) here", and
// "Smith" is now a link to a page called "2020".
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D8.
//
// Source of truth: CommonMark, checked with micromark: "[Smith][^1](2020)"
// renders "[Smith]", a footnote, "(2020)"; "[Smith](2020)" is a link. The
// readsDifferently guard exists to refuse a cut that changes how the text
// around it reads.

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("a reference between ']' and '('", () => {
    it.fails("does not leave a link behind when it is cut", () => {
        expect(md(["see [Smith][^1](2020) here", "", "[^1]: x"], "1")).not.toContain("[Smith](2020)");
    });
});
