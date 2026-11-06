import { describe, expect, it } from "vitest";

import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// spec question: when one carried number collides and is renamed, may it
// take a number that a later carried footnote was about to keep?
//
// What it does now: carried [^1] and [^2] are pasted into a note that has
// only [^1]. The carried [^1] collides and takes the smallest free number,
// 2. That pushes the carried [^2], which collided with nothing, on to 3.
// The toast reports two renames, and the pasted text reads "[^2] ... [^3]"
// where "[^3] ... [^2]" would have needed one.
// What a user might expect: only the footnote that actually collided is
// renamed, so [^2] keeps its number and [^1] becomes [^3], one rename.
// Why it is a question and not a bug: every pasted footnote still comes
// out unique and keeps its text, and the README's rule, "a number to the
// next free number", is followed to the letter, taken one footnote at a
// time. Whether fewer renames is worth numbers that run out of order in
// the pasted text is a product decision for Jason.
//
// Characterization test (behaviour pinned as it is, 2026-11-05, when the spec
// pins were sorted under Jason's scope rule of 2026-10-07): every pasted footnote
// comes out unique and keeps its text, and the numbers run in order in the
// pasted text.
// It was it.fails until then.
//
// Hunt 2026-10-02, round 1, lens carry-reg. Cluster C23.
//
// Source of truth: the README's Paste paragraph, "a name the destination
// already uses for something else is renamed, a number to the next free
// number".

// A carried definition: its name and its lines, as carriedDefinitions
// hands them over.
const one = (name: string, ...lines: string[]) => ({ name, lines });

describe("a rename takes the number a later carried footnote would keep", () => {
    it("characterization: the later footnote moves on, and two renames are counted", () => {
        const plan = planCarriedPaste("a[^1]\n\n[^1]: dest one", "b[^1] c[^2]", [one("1", "[^1]: one"), one("2", "[^2]: two")]);
        expect(plan.renamed).toBe(2);
        expect(plan.body).toBe("b[^2] c[^3]");
    });
});
