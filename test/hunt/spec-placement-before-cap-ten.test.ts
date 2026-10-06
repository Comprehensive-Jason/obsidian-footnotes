import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// spec question: should the punctuation rule settle a run of references
// alternating with "!" and "?" in one lint however long the run is, or is
// a cap on its repeats acceptable?
//
// What it does now: under "Before punctuation", "Is it true?" followed by
// eleven references, each followed by "!" or "?" in turn, is saved. Each
// pass of the rule moves one more reference, and the rule repeats its pass
// at most ten times, so the first lint leaves the line half done. The
// second save moves the rest. Since a lint of the text the last lint
// produced is skipped (lintNote's shortcut), that second save says "No
// linting needed." and moves nothing until the note is edited.
// What a user might expect: one lint settles the line, as it does for ten
// references or fewer.
// Why it is a question and not a bug: Jason has not ruled on the two
// repeat-until-settled loops (the punctuation rule's and the linter's) and
// their caps (an open question since hunt cycle 3); eleven references
// in a row, alternating with punctuation, is an unnatural note.
//
// "Before punctuation" is the footnote placement setting that puts a
// reference in front of the punctuation after a word.
//
// Options:
//   (a) make one pass of the rule settle a whole alternating run, so the
//       cap is never reached (recommended: the cap stays a safety net, as
//       its comment says, and the lint settles in one run);
//   (b) raise the cap or drop it, so the loop runs until nothing changes;
//   (c) keep the cap: notes this shape settle over two saves.
// The tests below take option (a) or (b).
//
// Hunt 2026-10-06, cycle 4, lens lint. Cluster L1.
//
// Origin: pre-existing (the cap came with the loop, 0ab94d8).
//
// Source of truth: the loop's own comment in
// src/linting/rules/footnote-after-punctuation.ts ("one lint settles the
// note ... the cap is a safety net"); lintNote's doc in
// src/linting/linter.ts ("The lint is meant to settle a note in one run").

/** "Is it true?" and `n` references, each followed by "!" or "?" in turn, then " Yes.". */
const chain = (n: number) => "Is it true?" + Array.from({ length: n }, (_, i) => `[^${String(i + 1)}]${i % 2 ? "?" : "!"}`).join("") + " Yes.";

describe("spec question: an alternating run of references longer than the cap", () => {
    it("control: ten references settle in one run", () => {
        const once = footnoteAfterPunctuation(chain(10), "before");
        expect(footnoteAfterPunctuation(once, "before")).toBe(once);
    });

    // Now: a second run of the rule still moves references.
    it.fails("eleven references alternating with ! and ? settle in one run under 'before'", () => {
        const once = footnoteAfterPunctuation(chain(11), "before");
        expect(footnoteAfterPunctuation(once, "before")).toBe(once);
    });

    // Now: a second lint still moves references.
    it.fails("the lint with placement 'before' is idempotent on that line", () => {
        const doc = chain(11) + "\n\n" + Array.from({ length: 11 }, (_, i) => `[^${String(i + 1)}]: note ${String(i + 1)}`).join("\n");
        const once = lintFootnotes(doc, { placement: "before" });
        expect(lintFootnotes(once, { placement: "before" })).toBe(once);
    });
});
