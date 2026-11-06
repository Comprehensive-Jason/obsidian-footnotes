import { describe, expect, it } from "vitest";

import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// spec question: should two carried footnotes with the same text merge
// into one definition on paste, the way a carried footnote merges into a
// destination definition with the same text?
//
// What it does now: the paste carries [^x] and [^y], both reading "same".
// It compares each one only with the destination's definitions, never
// with each other, so both are appended and the note gains two
// definitions with identical text.
// What a user might expect: one definition, "[^x]: same", with both pasted
// references pointing at it, as Convert inline footnotes to normal
// footnotes does with identical bodies.
// Why it is a question and not a bug: the source note had two footnotes,
// and the paste lands two, each with its own text, so nothing is lost or
// misread. The README's merge sentence only speaks of "a definition the
// destination already has". Whether a paste should also tidy duplicates
// that came from the source is a product decision for Jason.
//
// Characterization test (behaviour pinned as it is, 2026-11-05, when the spec
// pins were sorted under Jason's scope rule of 2026-10-07): the source note had
// two footnotes and the paste lands two, each with its own text, so nothing is
// lost or misread, and merging would break look-alikes such as "Ibid.", whose
// meaning depends on where they sit.
// It was it.fails until then.
//
// Hunt 2026-10-02, round 1, lens carry-plan. Cluster C24.
//
// Source of truth: the README's Paste paragraph, "A definition the
// destination already has (same text, whatever its name) is reused", and
// its Convert paragraph, "Identical bodies become one definition with
// several references".

// A carried definition: its name and its lines, as carriedDefinitions
// hands them over.
const one = (name: string, ...lines: string[]) => ({ name, lines });

describe("two carried definitions with identical text", () => {
    it("characterization: both land, each under its own name", () => {
        const plan = planCarriedPaste("p", "a[^x] b[^y]", [one("x", "[^x]: same"), one("y", "[^y]: same")]);
        expect(plan.definitions).toHaveLength(2);
        expect(plan.body).toBe("a[^x] b[^y]");
    });
});
