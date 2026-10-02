import { describe, expect, it } from "vitest";

import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// BUG (wrong output): a pasted footnote whose text matches the FIRST of two
// duplicate definitions in the destination is merged into it, though
// Obsidian shows only the last one.
//
// What the user would see: the destination defines [^1] twice, "one" then
// "uno". Obsidian shows "uno" for [^1]. They paste a footnote whose text
// is "one". The plugin sees that "one" already exists and points the
// pasted reference at [^1], so the pasted footnote now reads "uno" and its
// own text is gone.
//
// Hunt 2026-10-02, round 1, lens carry-int. Cluster C16.
//
// Source of truth: planCarriedPaste's own comment, "every definition body
// by its normalised text, the last block of a name winning as it does in
// Obsidian".
//
// Cause: planCarriedPaste records the body of every definition block,
// including the first, shadowed duplicate of a name. A shadowed body (one
// a later definition of the same name hides) is still offered for the
// merge, so the paste is merged into text Obsidian never shows.

describe("merge into a shadowed duplicate definition", () => {
    it.fails("a body equal to a SHADOWED duplicate (not the one Obsidian renders) is not reused", () => {
        const plan = planCarriedPaste(["x[^1]", "", "[^1]: one", "[^1]: uno"].join("\n"), "a[^5]", [{ name: "5", lines: ["[^5]: one"] }]);
        // Today the body comes back "a[^1]" with one reuse, so the pasted
        // reference shows "uno".
        expect(plan.body).not.toBe("a[^1]");
    });
});
