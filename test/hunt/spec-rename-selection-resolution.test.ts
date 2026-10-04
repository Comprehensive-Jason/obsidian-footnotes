import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";

import { renameTargetInSelection } from "../../src/commands/rename-footnote";

// spec question: when a selection covers more than one candidate, which
// footnote does Rename footnote take as its target?
//
// Hunt: 2026-09-13. Lens: the rename command's target resolvers.
//
// Manual sheet P states the selection rule plainly ("the selection
// decides"), with no qualifier about single lines and no tie-break for a
// selection holding two references. Two shapes fall in that gap.
//
// SHAPE 1: two references on one line, the selection running from just
// before the first one to a point INSIDE the second.
//   see [^a] and [^b] here
//       ^--------------^   (anchor at 4, head at 16, inside "[^b]")
// The resolver takes "a", the first reference on the line.
//   Reading A: the head is where the user's mouse or finger came to rest,
//   and it is sitting inside "[^b]", so "b" is the one they meant. The
//   caret rule already treats the head as the pointer everywhere else.
//   Reading B: first on the line is a simple, predictable rule, and a
//   selection over two references is ambiguous by nature, so the plugin
//   should either keep the simple rule or refuse and say so.
//
// SHAPE 2: a selection dragged from the start of a definition's label down
// into its continuation line.
//   [^x]: body
//       continuation
// The resolver returns nothing, so the command reports no footnote to
// rename even though the selection starts on the label.
//   Reading A: sheet P's rule (a definition label the selection overlaps
//   is the target) should hold across lines too, so this targets "x".
//   Reading B: the multi-line branch asks the caret rule at the head's
//   line by design (that is what its docstring says), and a drag into a
//   body is not a rename gesture, so returning nothing is right and only
//   the sheet needs the qualifier written down.
//
// Source of truth: manual sheet P (the selection rule, and the label
// rule), and renameTargetInSelection's own docstring for what the
// multi-line branch is designed to do.

const doc = (lines: string[]) => fakeEditor(lines, { wholeDoc: true });

// "see [^a] and [^b] here": [^a] is 4..8, [^b] is 13..17
const TWO_REFS = ["see [^a] and [^b] here", "", "[^a]: one", "[^b]: two"];

describe("shape 1: a selection ending inside the second reference", () => {
    it.fails("targets the reference the head is sitting in", () => {
        expect(
            renameTargetInSelection(doc(TWO_REFS), { line: 0, ch: 4 }, { line: 0, ch: 16 }),
        ).toBe("b");
    });

    // Controls, green today and unaffected by either reading: with one
    // reference in play the selection resolves to it.
    it("a selection of exactly one reference's name targets it (control)", () => {
        expect(
            renameTargetInSelection(doc(TWO_REFS), { line: 0, ch: 6 }, { line: 0, ch: 7 }),
        ).toBe("a");
        expect(
            renameTargetInSelection(doc(TWO_REFS), { line: 0, ch: 15 }, { line: 0, ch: 16 }),
        ).toBe("b");
    });

    it("a zero-length selection is the caret rule (control)", () => {
        expect(
            renameTargetInSelection(doc(TWO_REFS), { line: 0, ch: 6 }, { line: 0, ch: 6 }),
        ).toBe("a");
        expect(
            renameTargetInSelection(doc(TWO_REFS), { line: 0, ch: 8 }, { line: 0, ch: 8 }),
        ).toBeNull();
    });
});

describe("shape 2: a selection from a label into its continuation line", () => {
    const lines = ["ref[^x] here", "", "[^x]: body", "    continuation"];

    it.fails("targets the label the selection starts on", () => {
        expect(
            renameTargetInSelection(doc(lines), { line: 2, ch: 0 }, { line: 3, ch: 8 }),
        ).toBe("x");
    });

    it("a selection inside the label alone targets it (control)", () => {
        expect(
            renameTargetInSelection(doc(lines), { line: 2, ch: 2 }, { line: 2, ch: 3 }),
        ).toBe("x");
    });
});
