import { describe, expect, it } from "vitest";

import {
    computeNextFootnoteNumber,
    idListIncludes,
} from "../../src/parsing/footnote-grammar";

// Two small questions about what counts as the same footnote name. Neither
// is a verdict; both are recorded so a later change to either flips this
// file red on purpose.
//
// Hunt: 2026-09-13. Lens: grammar.
//
// spec question one: should two Unicode spellings of the same visible name
// be the same footnote?
// Reading one, match the reference grammar: no. micromark's
// normalizeIdentifier folds case and collapses whitespace, and does no
// Unicode normalization at all, so a name typed with a single "e-acute"
// character and a name typed as "e" plus a combining accent really are two
// different footnotes there. The plugin's idListIncludes folds case and
// nothing else, so it already matches that behaviour.
// Reading two, match what the user sees: yes. The two spellings look
// identical on screen, so a note edited outside Obsidian can come back
// carrying the decomposed spelling and the reference and the definition
// would then silently never pair up.
// What the user would see under reading two's complaint: a footnote that
// looks correct but behaves as an orphan. Low value in practice, since
// Obsidian's own cache almost certainly only lowercases too; recorded for
// completeness.
//
// Source of truth: micromark-util-normalize-identifier, used by
// micromark-extension-gfm-footnote 2.1.0 to decide footnote identity.

describe("spec question: Unicode spellings of one visible name", () => {
    it.fails("a composed and a decomposed spelling are the same footnote", () => {
        // "\u00e9" is the single character, and "e\u0301" is "e"
        // followed by a combining acute accent. They print the same.
        expect(idListIncludes(["\u00e9"], "e\u0301")).toBe(true);
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
