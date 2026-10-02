import { describe, expect, it } from "vitest";

import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// spec question: under Before placement, is the final dot of an
// abbreviation like "U.S." punctuation for the reference to step in front
// of?
//
// What it does now: b32cbd5 made "U.S." one word for the press ("a dot
// between two word characters belongs to the word"), but the final dot has
// no word character after it, so it counts as trailing punctuation. Under
// Before placement the lint turns "the U.S.[^1] law" into
// "the U.S[^1]. law", and a press after "U.S." lands there too.
//
// What a user might expect: "the U.S.[^1] law" left alone, since the dot
// is part of the abbreviation, not the end of a sentence.
//
// Why it is a question and not a bug: the plugin cannot tell an
// abbreviation's dot from a full stop that ends a sentence ("in the
// U.S." at the end of a sentence is both). Before placement puts the
// reference in front of a full stop by design. Whether abbreviations need
// an exception, and how to spot one, is a product decision for Jason.
//
// Hunt 2026-10-02, round 3, lens reg. Cluster E9.
//
// Source of truth: b32cbd5 (a dot between two word characters belongs to
// the word) and the Before placement convention (the reference goes in
// front of trailing punctuation).

describe("spec question: Before placement and an abbreviation's final dot", () => {
    it.fails("the lint leaves 'U.S.[^1]' whole under before", () => {
        // Today: "the U.S[^1]. law\n\n[^1]: d".
        expect(footnoteAfterPunctuation("the U.S.[^1] law\n\n[^1]: d", "before")).toBe("the U.S.[^1] law\n\n[^1]: d");
    });
});
