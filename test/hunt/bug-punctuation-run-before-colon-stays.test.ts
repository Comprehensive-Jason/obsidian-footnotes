// Imported from the Kimi K3 cycle 4 hunt of 2026-09-16 (OpenCode worktree); 4 of 6 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// The punctuation rule moves every reference that sits BEFORE punctuation
// to sit after it ("word[^1]." becomes "word.[^1]", and a run of adjacent
// references crosses a run of punctuation as one unit). Its one exception
// is a definition's own label: a reference run directly in front of a ":"
// with nothing but quote markers, "%", NULs, or whitespace in front of it
// is left alone, so "%% [^3]: def" and "> %% [^4]: def" are not mangled
// into ":[^3]" (the Claude-sweep guard).
//
// The guard's premise is "a run at the line's start before a colon is a
// label". But a definition label is ONE "[^name]" pair followed directly
// by ":" - a RUN of two or more pairs is never one (DefinitionStart
// requires the colon right after the name, and Obsidian agrees: "[^1][^2]:
// x" is two live references and a literal colon, never a definition).
// The rule's own single-reference behavior shows it: "see [^1]: x" becomes
// "see :[^1] x". The two-reference run at column 0 (or behind a quote
// marker) is the same shape, and the guard lets it keep the colon in
// front.
//
// What the user sees: "[^1][^2]: x" never gets its references placed after
// the colon, however many times the lint runs - the one placement the
// rule exists to make, skipped by a heuristic that mistook a reference
// run for a label.
//
// Source of truth: the rule's own convention (its catalogue examples and
// the colon behavior it applies to the single-reference shape) + the
// label grammar (DefinitionStart, one name then colon).
//
// Settings involved: `Move footnote references after punctuation` ON (the
// default).

describe("a run of references before a colon at the line's start", () => {
    it("crosses the colon like any other punctuation", () => {
        expect(footnoteAfterPunctuation("[^1][^2]: x")).toBe(":[^1][^2] x");
    });

    it("quoted: '> [^1][^2]: x' crosses it too", () => {
        expect(footnoteAfterPunctuation("> [^1][^2]: x")).toBe("> :[^1][^2] x");
    });

    it("control: a single reference before a colon mid-line crosses it", () => {
        expect(footnoteAfterPunctuation("see [^1]: x")).toBe("see :[^1] x");
    });

    it("an indented reference before a colon under a paragraph crosses it (four spaces is never a label)", () => {
        // "    [^1]: x" under a paragraph line is a paragraph continuation
        // (DefinitionStart allows at most three spaces of indent, so the
        // line is not label-shaped at all): a live reference and a colon.
        // The guard reads the indent as a label's and keeps the colon in
        // front.
        expect(footnoteAfterPunctuation("para\n    [^1]: x")).toBe("para\n    :[^1] x");
    });

    // SETTLED 2026-10-03 (the runtime swap, step 3): Obsidian reads
    // "[^1]: [^2]: x" as TWO definitions on one line, [^2] nested in [^1]
    // (rule E2 in docs/obsidian-reading-rules.md; the saved answers
    // probe:e2-nested-label and pin:bug-punctuation-run-before-colon-stays#1
    // in test/obsidian-answers/ list both labels as definitions and no
    // reference). So the "[^2]:" at the start of the body is a label, and
    // the rule leaves it alone like any other label. This test used to
    // expect "[^1]: :[^2] x", on the guess that the body was a reference
    // and a colon, which the probe did not bear out.
    it("a label at the START of a definition's body is a nested definition's label, and stays", () => {
        expect(footnoteAfterPunctuation("[^1]: [^2]: x")).toBe("[^1]: [^2]: x");
    });

    it("control: a real label is never mangled (one name, then colon)", () => {
        expect(footnoteAfterPunctuation("[^1]: x")).toBe("[^1]: x");
        expect(footnoteAfterPunctuation("> [^1]: x")).toBe("> [^1]: x");
        expect(footnoteAfterPunctuation("%% [^1]: x")).toBe("%% [^1]: x");
    });
});
