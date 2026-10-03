import { describe, expect, it } from "vitest";

import { carriedDefinitions } from "../../src/commands/carry-footnotes";

// spec question: when a selection ends after only the "[^" of a
// definition's label, should copy and cut carry that definition?
//
// What it does now: the note is "a[^1]", "", "[^1]: one". The selection
// runs from the start of the note to just after the "[^" that opens the
// label line "[^1]: one". carriedDefinitions treats the definition as
// travelling with the text, because the selection reaches its first
// line, so it carries nothing. The clipboard holds "a[^1]", a blank
// line, and a stray "[^", and no definition.
// What a user might expect: the definition carried after the text, as it
// is when the selection stops one line earlier, since the selection holds
// none of the definition's text besides two characters of its label.
// Why it is a question and not a bug: this selection cuts through a
// definition (it takes part of the label and leaves the rest), and
// selections that cut through a definition are out of scope for the
// first version of carrying. What it should do there is Jason's call:
// carry it, carry nothing, or treat the cut-through as plain text.
//
// Hunt 2026-10-02, round 1, lens carry-sel. Cluster C1b (the '[^'-only
// variant of C1, the line-wise selection boundary).
//
// Source of truth: the docstring of carriedDefinitions: "A block whose
// first line the selection contains travels with the text and is not
// carried again." Here the selection touches that line but does not
// contain it.

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
