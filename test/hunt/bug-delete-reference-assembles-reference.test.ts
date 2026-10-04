import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// BUG (wrong output, contrived): cutting a reference can assemble a new,
// live reference to another footnote out of the text around it.
//
// What the user would see: the line reads "a [[^1]^2] b". Reading view
// shows "[", footnote 1, "^2]": the "^2]" is plain text. Delete footnote
// everywhere on footnote 1 leaves "a [^2] b", which is now a live
// reference to footnote 2.
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D9.
//
// Source of truth: CommonMark, checked with micromark: the "[^2]" inside
// "[[^1]^2]" is literal text before the cut. A delete removes one
// footnote and should not bring another to life.

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("cutting a reference out of '[[^1]^2]'", () => {
    it("does not assemble a live reference to another footnote", () => {
        expect(md(["a [[^1]^2] b", "", "[^1]: x", "[^2]: y"], "1")).not.toContain("a [^2] b");
    });
});
