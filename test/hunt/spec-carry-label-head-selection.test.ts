import { describe, expect, it } from "vitest";

import { carriedDefinitions } from "../../src/commands/carry-footnotes";

// Settled behaviour: a selection that takes only the "[^" of a
// definition's label carries that definition.
//
// The note is "a[^1]", "", "[^1]: one". The selection runs from the
// start of the note to just after the "[^" that opens the label line
// "[^1]: one". A definition travels with the selected text only when the
// selection holds its whole label, "[^1]:". This selection holds two
// characters of it, so the definition is carried after the text: the
// clipboard holds "a[^1]", a blank line, the stray "[^", and the intact
// "[^1]: one". A cut removes only what was selected, so the damaged line
// "1]: one" stays in the note for the user to see and fix.
//
// This started as an open spec question from the hunt (2026-10-02, round
// 1, lens carry-sel, cluster C1b, the "[^"-only variant of C1, the
// line-wise selection boundary): the old code treated the definition as
// travelling with the text because the selection reached its first
// line, so the clipboard got no definition. Commit 558f786 settled it
// with one rule for copy and cut: containment is judged by character,
// by whether the selection holds the whole label (selectionHolds in
// src/commands/carry-footnotes.ts).
//
// Source of truth: the docstring of carriedDefinitions: "A block travels
// with the text, and is not carried again, exactly when the selection
// holds its whole label".

/** carriedDefinitions on a note given as lines. */
const carry = (lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) =>
    carriedDefinitions(lines.join("\n"), from, to);

describe("spec question: a selection that takes only the '[^' of a definition's label", () => {
    it("a selection that takes only the '[^' of a definition's label carries that definition", () => {
        expect(carry(["a[^1]", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 2, ch: 2 }).carried).toEqual([
            { name: "1", lines: ["[^1]: one"] },
        ]);
    });
});
