import { describe, expect, it } from "vitest";

import {
    computeNextFootnoteNumber,
    idListIncludes,
} from "../../src/parsing/footnote-grammar";

// Two small questions about what counts as the same footnote name. Both are
// recorded so a later change to either flips this file red on purpose.
//
// Hunt: 2026-09-13. Lens: grammar.
//
// Question one, settled by the live check of 2026-11-05 on Obsidian 1.15.0: two
// Unicode spellings of one visible name are two different footnotes. A reference
// and a definition whose names differ only in composed and decomposed spelling
// ("cafe" with its accent as one character or as two) do not pair in Obsidian,
// in either direction. The plugin's idListIncludes folds case and nothing else,
// so it agrees, and no code changed for this. Entry 5 of the spec sort of
// 2026-11-05.
//
// Source of truth: the live check above.

describe("Unicode spellings of one visible name (live check on Obsidian 1.15.0, 2026-11-05)", () => {
    // "é" is the single character, and "é" is "e" followed by a
    // combining acute accent. They print the same.
    it("a decomposed reference does not pair with a composed definition", () => {
        expect(idListIncludes(["é"], "é")).toBe(false);
    });

    it("a composed reference does not pair with a decomposed definition", () => {
        expect(idListIncludes(["é"], "é")).toBe(false);
    });
});

// spec question two: should a name that is a number with a leading zero
// reserve that number?
// Reading one, names are strings: "[^01]" and "[^1]" are two different
// footnotes, because footnote names are folded for case and for nothing
// else. Nothing stops the next autonumbered footnote from taking 1, so the
// next free number should be 1.
// Reading two, the documented contract of computeNextFootnoteNumber: hand
// back one more than the highest number already in use. It reads "01" as the
// number one, so the next free number is 2. This is what the code does
// today, and "[^007]" costs seven numbers the same way.
// What the user would see: creating a footnote in a note that contains
// "[^01]" mints "[^2]", skipping 1 for no visible reason.
// This is the one place a name is read as a number without the two
// spellings counting as the same footnote, so the two readings disagree on
// purpose. Harmless either way.
//
// Characterization test (behaviour pinned as it is, 2026-11-05, when the spec
// pins were sorted under Jason's scope rule of 2026-10-07): a number with a
// leading zero is rare, and skipping a number loses nothing, so reading two
// stands. It was it.fails until then.
//
// Source of truth: the documented "highest number in use" contract of
// computeNextFootnoteNumber in src/parsing/footnote-grammar.ts.

describe("a number name with a leading zero", () => {
    it("characterization: [^01] counts as the number 1, so the next free number is 2", () => {
        expect(computeNextFootnoteNumber("a[^01]b")).toBe(2);
    });
});
