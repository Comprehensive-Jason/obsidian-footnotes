import { describe, expect, it } from "vitest";

import { lineDiffChanges, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): when the lint moves two definitions with the same text
// ("twins", such as two "Ibid." footnotes), a fold on one of them ends up
// on the other, or is dropped.
//
// What the user would see: a note citing [^1] then [^2], with "[^2]:
// Ibid." listed above "[^1]: Ibid." (each with a second line "p. 4"), and
// a paragraph below them. The user folds [^2]'s definition and saves. The
// lint gathers both definitions at the bottom, [^1] first; the fold now
// sits on [^1]'s definition and [^2]'s is open. The same with named twins
// "[^x]: same" and "[^y]: same". With "Delete orphaned definitions" on, an
// unused "[^9]: Ibid." above a used "[^1]: Ibid." takes the used one's
// place in the line-up, and the fold on [^1]'s definition is dropped.
//
// A "fold" is a definition, list item, or heading collapsed with the arrow
// in the margin; the plugin puts every fold back after a lint.
//
// Hunt 2026-10-06, cycle 4, lens diff. Cluster D3.
//
// Origin: pre-existing (5b69297 gave it this shape).
//
// Source of truth: manual sheet 12, "Lint triggers and settings page"
// ("every fold is still folded", on the definition it was on); lineMapper's
// contract (a line rewritten or moved is still the same line).
//
// Cause: findMovedDefinitions in src/editor/document-diff.ts (5b69297)
// matches each moved definition to a definition after the lint by its text
// with the names set aside, taking the first one with that text that no
// other has taken. Twins have the same text, so the first moved one takes
// the first twin below, whatever its name; and a deleted twin takes the
// place of the used one.

/** The line where definition `name` starts in `text`. */
const labelLine = (text: string, name: string) => text.split("\n").findIndex((l) => l.startsWith(`[^${name}]:`));

describe("equal-text definitions keep their own folds", () => {
    // Now: the fold lands on [^1]'s definition (lines 4-5), not [^2]'s (6-7).
    it("two Ibid. definitions, both moved, listed out of order: the fold on [^2] stays on [^2]", () => {
        const before = ["See[^1] and[^2].", "", "[^2]: Ibid.", "    p. 4", "", "[^1]: Ibid.", "    p. 4", "", "Para."].join("\n");
        const after = lintFootnotes(before, {});
        const to = labelLine(after, "2");
        expect(mapFoldLines([{ from: 2, to: 3 }], lineDiffChanges(before, after), before)).toEqual([{ from: to, to: to + 1 }]);
    });

    // Now: the fold lands on [^y]'s definition (lines 4-5), not [^x]'s (6-7).
    it("named twins listed out of reference order: the fold on [^x] stays on [^x]", () => {
        const before = ["Text[^y] then[^x]", "", "[^x]: same", "    cont", "[^y]: same", "    cont", "", "Para."].join("\n");
        const after = lintFootnotes(before, {});
        const to = labelLine(after, "x");
        expect(mapFoldLines([{ from: 2, to: 3 }], lineDiffChanges(before, after), before)).toEqual([{ from: to, to: to + 1 }]);
    });

    // Now: the fold is dropped (an empty list).
    it("an orphaned Ibid. definition the lint deletes, above a used Ibid. twin it moves: the fold on the used one follows it", () => {
        const before = ["Intro[^1]", "", "[^9]: Ibid.", "    p. 4", "", "[^1]: Ibid.", "    p. 4", "", "Para."].join("\n");
        const after = lintFootnotes(before, { removeOrphanedDefinitions: true });
        expect(after.split("\n")).toEqual(["Intro[^1]", "", "Para.", "", "[^1]: Ibid.", "    p. 4"]);
        expect(mapFoldLines([{ from: 5, to: 6 }], lineDiffChanges(before, after), before)).toEqual([{ from: 4, to: 5 }]);
    });
});
