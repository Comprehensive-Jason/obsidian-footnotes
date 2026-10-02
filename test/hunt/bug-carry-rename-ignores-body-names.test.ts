import { describe, expect, it } from "vitest";

import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// BUG (wrong output): a carried footnote that collides with the destination
// is renamed onto a name the pasted text already uses for a different
// footnote.
//
// What the user would see: they copy "a[^1] b[^2]" and paste it into a
// note that already has its own [^1]. The carried [^1] is renamed to [^2],
// so both pasted references now read "[^2]" and point at the same
// footnote. The same happens when the selection held "[^2]: two" itself:
// the renamed [^1] lands on the [^2] the pasted text defines, and one of
// the two footnotes is lost.
//
// Hunt 2026-10-02, round 1, lens carry-plan. Cluster C14.
//
// Source of truth: the README's Paste paragraph, "a name the destination
// already uses for something else is renamed ... so the pasted footnotes
// come out unique with no setup".
//
// Cause: planCarriedPaste builds its set of taken names from the
// destination note only. The names the pasted body itself uses (a
// reference with no carried definition, or a definition that travels
// inside the body) are never added to it, so the smallest free number can
// be one of them.

// A carried definition: its name and its lines, as carriedDefinitions
// hands them over.
const one = (name: string, ...lines: string[]) => ({ name, lines });

describe("a carried rename lands on a name the pasted body already uses", () => {
    it.fails("a carried number is not renamed onto the number of a body reference that has no carried definition", () => {
        // The source is "a[^1] b[^2]" with [^1]: uno. Nothing defines [^2]
        // in the source, so nothing carries it.
        const plan = planCarriedPaste("x[^1]\n\n[^1]: one", "a[^1] b[^2]", [one("1", "[^1]: uno")]);
        // [^2] stays without a definition, so the carried [^1] must go to 3.
        expect(plan.body).toBe("a[^3] b[^2]");
    });

    it.fails("a carried number is not renamed onto a name the body defines itself", () => {
        // The selection included "[^2]: two", so that definition travels in
        // the body and is not carried.
        const plan = planCarriedPaste("x[^1]\n\n[^1]: other", "a[^1] b[^2]\n\n[^2]: two", [one("1", "[^1]: uno")]);
        // The carried [^1] must not become [^2], which the body already
        // defines as "two".
        expect(plan.body).not.toContain("a[^2]");
    });
});
