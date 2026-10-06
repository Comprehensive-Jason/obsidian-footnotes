import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): with Delete orphaned definitions on, a fold on a used
// definition is dropped when an orphaned definition with the same text sits
// above it and the lint renumbers the used one to the orphan's name.
//
// An "orphaned" definition is one that nothing references; Delete orphaned
// definitions deletes it. Two definitions with the same text, such as two
// "Ibid." footnotes, are "twins". A "fold" is a definition, list item, or
// heading collapsed with the arrow in the margin; the plugin puts every
// fold back after a lint.
//
// What the user would see: "Intro[^3]", then "[^1]: Ibid." (cited
// nowhere), then "[^3]: Ibid." (each with a second line "p. 4"), then
// "Para.". The user folds [^3]'s definition and saves. The lint deletes
// [^1]'s definition, renumbers [^3] to [^1], and moves it to the bottom;
// the fold is gone and the definition is open. A second pane's caret on it
// lands elsewhere.
//
// Hunt 2026-10-06, cycle 5, lens diff. Cluster X18.
//
// Origin: pre-existing (de2d023 gave it this shape, with renamesOf).
//
// Source of truth: manual sheet 12, "Lint triggers and settings page"
// ("every fold is still folded", on the definition it was on);
// findMovedDefinitions's contract (a definition the lint moved is found
// again by its name as the lint renamed it); lineMapper's contract (a line
// moved is still the same line); pin bug-fold-follows-wrong-twin (its
// orphan test, where the orphan's name is one the lint gives nobody).
//
// Cause: findMovedDefinitions in src/editor/document-diff.ts looks for each
// definition, in the order of the note, under its name as the lint renamed
// it (renamesOf), and takes a definition with that name and the same text.
// Nothing references the orphan, so no rename is known for it and it is
// looked for under its own name "1". After the lint, "1" is the name of the
// renamed [^3], with the same text, so the orphan takes it. The used
// definition, looked for next under "1", finds it already taken, and no
// other twin is left for the text fallback, so its fold is dropped.

describe("an orphaned twin whose name is the name the lint gives the used twin", () => {
    // Now: the fold is dropped (an empty list).
    it.fails("the fold on the used twin follows it; the orphan takes nothing", () => {
        const before = ["Intro[^3]", "", "[^1]: Ibid.", "    p. 4", "", "[^3]: Ibid.", "    p. 4", "", "Para."].join("\n");
        const after = lintFootnotes(before, { removeOrphanedDefinitions: true });
        expect(after.split("\n")).toEqual(["Intro[^1]", "", "Para.", "", "[^1]: Ibid.", "    p. 4"]);
        expect(mapFoldLines([{ from: 5, to: 6 }], lineDiffChanges(before, after), before)).toEqual([{ from: 4, to: 5 }]);
        const map = lineMapper(lineDiffChanges(before, after), before);
        expect(map(5)).toBe(4);
    });

    // The same with the orphan below the used twin: the used one is looked
    // for first and takes its own place by name.
    it("control: the orphan below the used twin", () => {
        const before = ["Intro[^3]", "", "[^3]: Ibid.", "    p. 4", "", "[^1]: Ibid.", "    p. 4", "", "Para."].join("\n");
        const after = lintFootnotes(before, { removeOrphanedDefinitions: true });
        expect(after.split("\n")).toEqual(["Intro[^1]", "", "Para.", "", "[^1]: Ibid.", "    p. 4"]);
        expect(mapFoldLines([{ from: 2, to: 3 }], lineDiffChanges(before, after), before)).toEqual([{ from: 4, to: 5 }]);
    });
});
