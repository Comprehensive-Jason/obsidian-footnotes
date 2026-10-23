import { describe, expect, it } from "vitest";

import { noteSplitCreation, undoOrphanMessage } from "../../src/editor/undo-orphan-notice";

// Jason's manual pass (2026-09-11): the partial-undo notice said "Undo
// again to remove the reference too" after EVERY undo that removed a
// definition while its reference stayed, whether or not a second undo
// would remove that reference. The promise is only true when the plugin
// itself split the creation into two history steps (a table-cell creation:
// reference through the cell's editor, definition through the main
// editor). Everywhere else the notice states the fact and stops.

describe("the partial-undo notice", () => {
    it("states the fact without the promise for an undo the plugin did not stage", () => {
        expect(undoOrphanMessage(["typed"], '"[^typed]"')).toBe(
            'The undo removed the footnote definition, but the footnote reference "[^typed]" is still in the note.',
        );
        expect(undoOrphanMessage(["a", "b"], '"[^a]", "[^b]"')).toBe(
            'The undo removed footnote definitions, but their references "[^a]", "[^b]" are still in the note.',
        );
    });

    it("promises the second undo only for a creation the plugin split itself, any casing", () => {
        // the record is the note's text just before the definition's
        // history step (2026-09-16, B27): the undo that takes the
        // definition out leaves the note reading exactly that
        const textBefore = "| a[^Cell] |\n| --- |\n";
        noteSplitCreation("Cell", textBefore);
        expect(undoOrphanMessage(["cell"], '"[^cell]"', textBefore)).toBe(
            'The undo removed the footnote definition, but the footnote reference "[^cell]" is still in the note. Undo again to remove the reference too.',
        );
        // one stranded name that was not staged keeps the promise out
        expect(undoOrphanMessage(["cell", "typed"], '"[^cell]", "[^typed]"', textBefore)).toBe(
            'The undo removed footnote definitions, but their references "[^cell]", "[^typed]" are still in the note.',
        );
    });

    it("an undo that leaves the note reading anything else gets no promise, even for that name", () => {
        // the note was edited after the creation, so the previous history
        // step is no longer the reference step
        const textBefore = "| a[^Cell] |\n| --- |\n";
        noteSplitCreation("Cell", textBefore);
        expect(undoOrphanMessage(["cell"], '"[^cell]"', textBefore + "more")).toBe(
            'The undo removed the footnote definition, but the footnote reference "[^cell]" is still in the note.',
        );
    });
});
