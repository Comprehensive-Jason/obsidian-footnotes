import { describe, expect, it } from "vitest";

import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// spec question: when the destination holds look-alike footnotes (two
// "Ibid."), should the paste planner search for the pairing that lets
// every pasted footnote be reused, or is taking the first fit enough?
//
// What it does now: the destination has [^1] "Ibid.", [^2] "Ibid.", and
// [^3] "see [^1]". A paste from another note carries [^a] "Ibid." and
// [^b] "see [^a]". Pairing [^a] with [^1] would let [^b] be reused as
// [^3], and nothing would be added. The planner pairs [^a] with [^2]
// instead (of two look-alikes it tries one with the same name first,
// then the later one) and keeps that choice, so [^b], now "see [^2]",
// no longer matches [^3]'s "see [^1]" and is added as a new footnote.
// What a user might expect: both pasted footnotes reused, nothing added,
// since the destination already holds exactly these two footnotes.
// Why it is a question and not a bug: the outcome is still correct (a
// duplicate of "see Ibid." is added, nothing is lost or misread), and
// finding the best pairing in general means searching through the
// choices, which costs time on notes with many look-alikes. The hunt
// filed it as a spec question leaning bug.
//
// Hunt 2026-10-06, cycle 4, lens carry. Cluster K6.
//
// Origin: not checked against ea38e82; the pairing of names by place
// came in with 7541847.
//
// Source of truth: the README's Paste paragraph ("A definition the
// destination already has (same text, whatever its name) is reused").

describe("spec question: greedy pairing in the paste planner", () => {
    it.fails("a footnote with a look-alike pairs with the one the citing block needs (Ibid.)", () => {
        const destination = "x[^1] y[^2] z[^3]\n\n[^1]: Ibid.\n[^2]: Ibid.\n[^3]: see [^1]";
        const plan = planCarriedPaste(destination, "A[^a] B[^b]", [
            { name: "a", lines: ["[^a]: Ibid."] },
            { name: "b", lines: ["[^b]: see [^a]"] },
        ]);
        // Today [^b] is added as "[^b]: see [^2]" and the body reads "A[^2] B[^b]".
        expect(plan.added).toBe(0);
    });
});
