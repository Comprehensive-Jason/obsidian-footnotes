import { describe, expect, it } from "vitest";

import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { nameForBody } from "../../src/parsing/footnote-grammar";

// BUG (wrong output): the Named footnote naming style cuts a word apart at
// every combining mark, so the name is a fragment of the word.
//
// What the user would see: a footnote's text starts with "école" typed
// with a separate accent character, as text pasted from a PDF or from
// macOS often is. The reindex lint with Named on calls the footnote
// "[^cole]". A Hindi footnote starting "हिन्दी पाठ" gets a name cut off
// at the first vowel sign, and Thai words are cut the same way, because
// those scripts write their vowels as combining marks.
//
// Hunt 2026-10-02, round 2, lens properties. Cluster P6.
//
// Source of truth: the docstrings promise "the first meaningful word of
// the body" (commit 4b23542). The plugin's own word definition,
// isWordCharAt in markdown-scan.ts, counts letters, numbers and combining
// marks ([\p{L}\p{N}\p{M}]) as word characters.
//
// Cause: nameForBody splits words on [\p{L}\p{N}]+, which leaves
// combining marks (\p{M}) out.

// "école" written as "e" plus a combining acute accent (U+0301), not as
// the single character "é".
const ecole = "école";

describe("Named: words with combining marks", () => {
    it.fails("a decomposed accent stays inside the word", () => {
        const out = reindexFootnotes(`a[^1]\n\n[^1]: ${ecole} normale`, { nameNumberedFootnotes: true });
        // Today: "a[^cole]" - the name lost its first letter.
        expect(out).toBe(`a[^${ecole}]\n\n[^${ecole}]: ${ecole} normale`);
    });

    it.fails("a Devanagari word is named whole", () => {
        expect(nameForBody("हिन्दी पाठ", new Set())).toBe("हिन्दी");
    });
});
