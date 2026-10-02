import { describe, expect, it } from "vitest";

import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// BUG (annoyance): with footnote placement "before", two references
// separated only by closing marks need two lints to settle.
//
// What the user would see: the line reads "(see “this[^1]”[^2]) next".
// The first lint gives "(see “this”[^1])[^2] next", and the second lint
// moves [^1] again, so a lint on save changes the line twice in a row.
//
// Hunt 2026-10-02, round 2, lens placement. Cluster L2.
//
// Source of truth: the punctuation rule's idempotence claim (one lint
// leaves nothing for a second lint to do; test/footnote-placement.test.ts).
//
// Cause: under "before" the forward move has no "already placed" stop, and
// one reference's walk ends at the next reference's "[". When both move
// forward in the same pass, the first stops where the second used to
// start, and only the next lint carries it on.

describe("before: two references separated by closing marks", () => {
    it.fails("(see “this[^1]”[^2]) next settles in one pass", () => {
        const once = footnoteAfterPunctuation("(see “this[^1]”[^2]) next", "before");
        expect(footnoteAfterPunctuation(once, "before")).toBe(once);
    });
});
