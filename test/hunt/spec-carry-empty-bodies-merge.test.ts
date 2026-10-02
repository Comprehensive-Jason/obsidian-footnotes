import { describe, expect, it } from "vitest";

import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// spec question: should a carried definition with no text be merged into
// a destination definition that also has no text?
//
// What it does now: two empty definitions count as identical. A carried
// [^1] still waiting for its text is merged into the destination's empty
// [^x], the pasted reference is pointed at [^x], and from then on two
// unrelated footnotes share one definition. Typing text into it fills
// both.
// What a user might expect: an empty definition is a placeholder, not
// text, so the carried one lands as its own [^1].
// Why it is a question and not a bug: by the merge rule as written, two
// empty bodies are the same text. Convert inline footnotes to normal
// footnotes makes the other choice: it leaves an empty ^[] alone, so it
// never merges an empty body, and the two features disagree. Which way is
// right is a product decision for Jason.
//
// Hunt 2026-10-02, round 1, lens carry-reg. Cluster C26.
//
// Source of truth: the README's Paste paragraph, "A definition the
// destination already has (same text, whatever its name) is reused", and
// its Convert paragraph, "An empty ^[] ... [is] left alone"
// (convert-footnotes.ts skips "empty").

// A carried definition: its name and its lines, as carriedDefinitions
// hands them over.
const one = (name: string, ...lines: string[]) => ({ name, lines });

describe("spec question: an empty carried definition and an empty destination definition", () => {
    it.fails("are not merged", () => {
        const plan = planCarriedPaste("a[^x]\n\n[^x]:", "b[^1]", [one("1", "[^1]:")]);
        expect(plan.body).toBe("b[^1]");
        expect(plan.reused).toBe(0);
    });
});
