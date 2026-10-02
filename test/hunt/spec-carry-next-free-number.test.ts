import { describe, expect, it } from "vitest";

import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// spec question: when a pasted number clashes, should it take the lowest
// unused number or the number after the highest one?
//
// What it does now: the destination has [^1] and [^3]. A paste carries its
// own [^1], which clashes, and it is renamed to [^2]: the gap. The pasted
// footnote then sits between [^1] and [^3] in name but after them in the
// note, out of reading order until the next renumbering lint.
// What a user might expect: the README says a clashing number goes "to the
// next free number", and the README uses the same words for the creation
// press, where "the next free number" means one past the highest (here
// [^4]).
// Why it is a question and not a bug: filling the gap is a reasonable
// reading of "free", and the reindex rule puts the order right on the next
// lint anyway. Which reading the README means is Jason's call; the answer
// may be a README edit.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster PR6.
//
// Source of truth: the README's Paste paragraph ("a number to the next
// free number") and its Numbered footnotes paragraph ("The plugin finds the
// next free number"), which computeNextFootnoteNumber implements as one
// past the highest.

describe("spec question: the number a clashing pasted footnote takes", () => {
    it.fails("a clashing number takes the next free number past the destination's", () => {
        const plan = planCarriedPaste("x[^1] y[^3]\n\n[^1]: one\n[^3]: three", "a[^1]", [{ name: "1", lines: ["[^1]: mine"] }]);
        // Today: "a[^2]".
        expect(plan.body).toBe("a[^4]");
    });
});
