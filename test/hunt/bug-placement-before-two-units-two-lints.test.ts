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
//
// Fix (2026-10-06): swapInSegment in
// src/linting/rules/footnote-after-punctuation.ts carries a run whose
// forward move ends at the next run's start on with that run, written in
// front of it wherever it lands, so one lint gives "(see “this”)[^1][^2]
// next". Under "after" the next run never moves forward from there, so
// nothing changes for that placement.

describe("before: two references separated by closing marks", () => {
    it("(see “this[^1]”[^2]) next settles in one pass", () => {
        const once = footnoteAfterPunctuation("(see “this[^1]”[^2]) next", "before");
        expect(footnoteAfterPunctuation(once, "before")).toBe(once);
    });
});

describe("before: the one-pass result", () => {
    it("(see “this[^1]”[^2]) next gives both references after the bracket in one lint", () => {
        expect(footnoteAfterPunctuation("(see “this[^1]”[^2]) next", "before")).toBe("(see “this”)[^1][^2] next");
    });

    it("control: under after the same line keeps both inside the bracket, as before the fix", () => {
        expect(footnoteAfterPunctuation("(see “this[^1]”[^2]) next", "after")).toBe("(see “this”[^1][^2]) next");
    });
});
