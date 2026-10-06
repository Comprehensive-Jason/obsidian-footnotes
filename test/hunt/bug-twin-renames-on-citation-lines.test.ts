import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): when two definitions have the same text ("twins", such
// as two "Ibid." footnotes) and the lint renumbers them, a fold on one of
// them ends up on the other, if their references sit only on citation
// lines.
//
// A "citation line" is a line that holds nothing but references, such as
// "[^2]" on a line of its own. A "fold" is a definition, list item, or
// heading collapsed with the arrow in the margin; the plugin puts every
// fold back after a lint.
//
// What the user would see: two paragraphs, the first cited by a line
// "[^2]" under it and the second by a line "[^1]", then "[^1]: Ibid." and
// "[^2]: Ibid." (each with a second line "p. 4"), then "Tail.". The user
// folds [^2]'s definition and saves. The lint renumbers [^2] to [^1] and
// [^1] to [^2] and gathers both definitions at the bottom; the fold now
// sits on the other twin, and the one the user folded is open. A second
// pane's caret on either definition lands on the other one too.
//
// Hunt 2026-10-06, cycle 5, lens diff. Cluster X17.
//
// Origin: pre-existing (de2d023 gave it this shape, with renamesOf).
//
// Source of truth: manual sheet 12, "Lint triggers and settings page"
// ("every fold is still folded", on the definition it was on);
// findMovedDefinitions's contract (a definition the lint moved is found
// again by its name as the lint renamed it, so twins are told apart);
// lineMapper's contract (a line moved is still the same line); pin
// bug-fold-follows-wrong-twin (the same promise with the references in
// prose).
//
// Cause: renamesOf in src/editor/document-diff.ts learns the lint's
// renames from lines it rewrote in place, comparing each line's text with
// its footnotes taken out (lineKey). A citation line has nothing left once
// its footnotes are out, so lineKey keeps the footnotes in its key, and a
// renumbered citation line never has the same key as its new self:
// renamesOf skips it. With no rename known, findMovedDefinitions looks for
// each definition under its old name, and finds the twin that now carries
// that name, with the same text.

/** The line where definition `name` starts in `text`. */
const labelLine = (text: string, name: string) => text.split("\n").findIndex((l) => l.startsWith(`[^${name}]:`));

describe("twins whose renames the lint made are visible only on citation lines", () => {
    // Now: the fold on [^2]'s definition (lines 9 and 10) comes back on
    // lines 10 and 11, the other twin.
    it.fails("the fold on the first-cited twin follows it to its new name", () => {
        const before = ["Para.", "[^2]", "", "Para.", "[^1]", "", "[^1]: Ibid.", "    p. 4", "", "[^2]: Ibid.", "    p. 4", "", "Tail."].join("\n");
        const after = lintFootnotes(before, {});
        expect(after.split("\n")).toEqual(["Para.", "[^1]", "", "Para.", "[^2]", "", "Tail.", "", "[^1]: Ibid.", "    p. 4", "[^2]: Ibid.", "    p. 4"]);
        // the old [^2] (line 9) is the new [^1] (cited first, listed first)
        const to = labelLine(after, "1");
        expect(mapFoldLines([{ from: 9, to: 10 }], lineDiffChanges(before, after), before)).toEqual([{ from: to, to: to + 1 }]);
        // and the old [^1] (line 6) is the new [^2]
        const map = lineMapper(lineDiffChanges(before, after), before);
        expect(map(6)).toBe(labelLine(after, "2"));
        expect(map(9)).toBe(labelLine(after, "1"));
    });

    // The same note with the references inside prose lines, where renamesOf
    // can read the renames.
    it("control: the same renames on prose lines: the fold follows", () => {
        const before = ["Para.[^2]", "", "Para.[^1]", "", "[^1]: Ibid.", "    p. 4", "", "[^2]: Ibid.", "    p. 4", "", "Tail."].join("\n");
        const after = lintFootnotes(before, {});
        expect(after.split("\n")).toEqual(["Para.[^1]", "", "Para.[^2]", "", "Tail.", "", "[^1]: Ibid.", "    p. 4", "[^2]: Ibid.", "    p. 4"]);
        const to = labelLine(after, "1");
        expect(mapFoldLines([{ from: 7, to: 8 }], lineDiffChanges(before, after), before)).toEqual([{ from: to, to: to + 1 }]);
    });
});
