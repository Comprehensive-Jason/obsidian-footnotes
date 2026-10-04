import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";

import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// Scenario: a backslash-escaped reference "\[^9]" is literal text per CommonMark
// §2.4, yet it gets renumbered by reindex, listed as a reference occurrence,
// and reserves autonumbers.
// Hunt: 2026-08-09. Lens: grammar.
// Root cause: the AllReferences regex has no escape-awareness - it matches "[^…]"
// even when preceded by a backslash.

describe("fixed 2026-08-10: backslash-escaped references are treated as real footnotes", () => {
    it("does not treat a backslash-escaped reference as a footnote during reindex", () => {
        const input = "literal \\[^9] real[^7]\n\n[^7]: real";
        expect(reindexFootnotes(input)).toBe("literal \\[^9] real[^1]\n\n[^1]: real");
    });

    it("does not list a backslash-escaped reference as a footnote", () => {
        const line = "literal \\[^fake] real[^ok]";
        expect(readNote([line]).referencesOn(0)).toEqual([
            { name: "ok", start: 21, end: 26 },
        ]);
    });

    it("escaped numeric reference does not reserve the next autonumber", () => {
        expect(computeNextFootnoteNumber("literal \\[^99]")).toBe(1);
    });
});
