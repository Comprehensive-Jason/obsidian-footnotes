import { describe, expect, it } from "vitest";

import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";

// spec question: with the Named footnote naming style, may a footnote be
// named after another footnote it cites?
//
// What it does now: "[^1]: see [^2]" offers no word of its own ("see" is a
// filler word, "2" is digits), so the first pass leaves [^1] numbered and
// names [^2] "two" from its text. The second pass then reads
// "see [^two]" and names [^1] "two-2", after the footnote it cites.
// What a user might expect: [^1] stays numbered. In Reading view the
// reference shows as a superscript number, so "two" is not a word of
// footnote 1's text.
// Why it is a question and not a bug: the reference name is literally in
// the body, and the docstrings do not say whether reference names count
// as words. Commit 4b23542 says a footnote "whose definition offers no
// word stays numbered", which leans towards leaving [^1] alone.
//
// Hunt 2026-10-02, round 2, lens properties. Cluster P8.
//
// Source of truth: commit 4b23542 ("names taken from the first meaningful
// word of their definitions ... a numbered footnote whose definition
// offers no word stays numbered").

describe("spec question: Named and a reference inside a footnote's text", () => {
    it.fails("Named does not name a footnote after a reference name in its body", () => {
        const out = reindexFootnotes("a[^1] b[^2]\n\n[^1]: see [^2]\n[^2]: two", { nameNumberedFootnotes: true });
        // Today: "a[^two-2] b[^two]\n\n[^two-2]: see [^two]\n[^two]: two".
        expect(out).toBe("a[^1] b[^two]\n\n[^1]: see [^two]\n[^two]: two");
    });
});
