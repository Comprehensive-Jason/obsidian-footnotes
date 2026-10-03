import { describe, expect, it } from "vitest";

import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// BUG (wrong output, rare): with footnote placement "before", a reference
// right after a colon at the start of a line becomes a new definition
// label.
//
// What the user would see: a line starts ":[^1] colon first". The lint
// moves the reference in front of the colon and writes
// "[^1]: colon first", which is a label: the reference is gone and
// footnote 1 now has a second definition reading "colon first". The next
// lint deletes or merges that duplicate.
//
// Hunt 2026-10-02, round 2, lens properties. Cluster P3.
//
// Source of truth: CONTEXT.md (a label is the "[^name]:" head of a
// definition, and a label never counts as a reference) and the punctuation
// rule's docstring (a move, never a change of what the text is).
//
// Cause: the "before" walk moves the reference back over the colon without
// checking that the result starts a line with "[^name]:".

describe("placement 'before' and a line-initial colon", () => {
    it("a reference after a line-initial colon must not become a definition label", () => {
        const doc = "Intro[^1].\n\n:[^1] colon first\n\n[^1]: one";
        const out = footnoteAfterPunctuation(doc, "before");
        // Today the third line becomes "[^1]: colon first".
        expect(out).not.toContain("\n[^1]: colon first");
    });
});
