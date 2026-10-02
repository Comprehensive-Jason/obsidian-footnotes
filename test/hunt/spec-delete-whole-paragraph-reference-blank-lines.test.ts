import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// spec question: when a cut reference was a whole paragraph, should the
// emptied line merge with the blank lines around it?
//
// What it does now: "a", "", "[^1]", "", "b" becomes "a", "", "", "",
// "b": three blank lines between the two paragraphs.
// What a user might expect: one blank line, "a", "", "b".
// Why it is a question and not a bug: Reading view shows the same thing
// either way; this is about the note's source. The delete merges blank
// lines around a removed definition, but not around an emptied reference
// line. Whether it should is Jason's call.
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D11.
//
// Source of truth: none written down; the delete's own blank-line merge
// for removed definitions.

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("spec question: a reference that was a whole paragraph", () => {
    it.fails("leaves one blank line, not three", () => {
        expect(md(["a", "", "[^1]", "", "b", "", "[^1]: x"], "1")).toBe("a\n\nb");
    });
});
