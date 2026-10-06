import { describe, expect, it } from "vitest";

import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): under "Before punctuation", the lint's move can turn
// a reference into an inline footnote, or an inline footnote into a
// reference.
//
// What the user would see: with footnote placement set to before
// punctuation, "e = mc^.[^1] next" is saved, and the lint writes
// "e = mc^[^1]. next". The "^" in front now makes "^[^1]" an inline
// footnote whose text is "^1": the footnote [^1] loses its only reference
// and its definition is orphaned. The other way round, "a [.^[note] b"
// becomes "a [^[note]. b", which reads as a reference named "[note", so
// the inline footnote is gone.
//
// An "inline footnote" is "^[text]" written in the line itself.
//
// Hunt 2026-10-06, cycle 3, lens lint. Cluster L5.
//
// Origin: pre-existing (cec4352 gives the same output); 104fd32's check was
// meant to cover it.
//
// Source of truth: 104fd32's promise ("the punctuation rule never makes a
// move that kills the footnote it moves"); Obsidian's inline footnote
// syntax "^[...]". The note reading's own answer shows the change of kind.
//
// Cause: the check 104fd32 added to src/linting/rules/footnote-after-punctuation.ts
// counts live references plus inline footnotes on the line; one of each
// swapped for the other keeps the count, so the move goes through.

/** The names of the references on line 0 of `text`, and how many inline footnotes it holds. */
function kinds(text: string): { references: string[]; inline: number } {
    const reading = readNote(text.split("\n"));
    return { references: reading.referencesOn(0).map((r) => r.name), inline: reading.inlineNotesOn(0).length };
}

describe("before: a move never changes a footnote's kind", () => {
    // Before the fix: "e = mc^[^1]. next", an inline footnote "^[^1]".
    it("e = mc^.[^1] keeps [^1] a reference", () => {
        const doc = "e = mc^.[^1] next\n\n[^1]: a";
        const out = footnoteAfterPunctuation(doc, "before");
        expect(kinds(out)).toEqual({ references: ["1"], inline: 0 });
    });

    // Before the fix: "a [^[note]. b", a reference named "[note".
    it("a [.^[note] b keeps the inline footnote", () => {
        const out = footnoteAfterPunctuation("a [.^[note] b", "before");
        expect(kinds(out)).toEqual({ references: [], inline: 1 });
    });
});
