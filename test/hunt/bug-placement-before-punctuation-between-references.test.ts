import { describe, expect, it } from "vitest";

import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// BUG (annoyance): under "Before punctuation", two references with a
// punctuation mark between them take two lints to settle.
//
// What the user would see: with footnote placement set to before
// punctuation, 'He said "yes[^1]![^2]" and left.' is saved. The first
// lint moves only [^2] out past the closing quote; the second save, with
// nothing typed in between, moves [^1] out after it. The same with
// parentheses, a comma, and Chinese quotes.
//
// Hunt 2026-10-06, cycle 3, lens lint. Cluster L3.
//
// Origin: pre-existing for the English shapes (cec4352 gives the same two
// steps). The Chinese shape "他说「好[^1]！[^2]」然后" is new in its first
// step since ebc4cb4: cec4352 settled it at once as "他说「好[^1][^2]！」然后"
// (inside the quote); now it gives "他说「好[^1]！」[^2]然后" and then
// "他说「好！」[^1][^2]然后".
//
// Source of truth: the rule's own examples ("「句子[^1]。」" becomes
// "「句子。」[^1]" under "before": a reference lands outside a closing
// quote) and its claim that one pass does what two did (swapInSegment's
// comment); the lint's promise to settle a note in one run. Sibling of the
// fixed pin bug-placement-before-two-units-two-lints (0a01cca).
//
// Cause: in src/linting/rules/footnote-after-punctuation.ts, under
// "before" a reference steps over punctuation only together with a
// closing mark that follows it. The first reference's punctuation is
// followed by the second reference's "[", so it stays; the second moves
// out past the closing mark. On the next lint the first reference's
// punctuation is followed by the closing mark, and it moves too. 0a01cca
// lets a run carry on with the next run only when it ends exactly where
// that run starts.

describe("before: two references with a punctuation mark between them settle in one lint", () => {
    const cases: [string, string][] = [
        ['He said "yes[^1]![^2]" and left.', 'He said "yes!"[^1][^2] and left.'],
        ["He said (yes[^1]![^2]) and left.", "He said (yes!)[^1][^2] and left."],
        ["see (this[^1],[^2]) next", "see (this,)[^1][^2] next"],
        ["他说「好[^1]！[^2]」然后", "他说「好！」[^1][^2]然后"],
    ];
    for (const [line, settled] of cases) {
        it(`${line} settles in one lint`, () => {
            const doc = `${line}\n\n[^1]: a\n[^2]: b`;
            const once = footnoteAfterPunctuation(doc, "before");
            expect(footnoteAfterPunctuation(once, "before")).toBe(once);
            expect(once).toBe(`${settled}\n\n[^1]: a\n[^2]: b`);
        });
    }

    it("a reference after a question mark and another after an exclamation mark", () => {
        const doc = "Is it true?[^1]![^2] Yes.\n\n[^1]: a\n[^2]: b";
        const once = footnoteAfterPunctuation(doc, "before");
        expect(footnoteAfterPunctuation(once, "before")).toBe(once);
    });
});
