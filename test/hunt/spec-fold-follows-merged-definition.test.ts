import { describe, expect, it } from "vitest";

import { lineDiffChanges, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// spec question: when the lint both moves a folded definition and merges a
// duplicate into it, should the fold stay on that definition?
//
// What it does now: with "Merge duplicate definitions" on, a note with
// "[^1]: alpha" / "    cont" (folded) near the top and a second "[^1]:
// beta" further down. The lint merges "beta" into the first as a new last
// line and moves the definition to the bottom. The fold is dropped, and
// the definition shows open.
// What a user might expect: the definition stays folded where it moved to,
// now three lines long.
// Why it is a question and not a bug: the definition was edited as well
// as moved, and Obsidian itself drops a fold on any edit inside it; the
// plugin puts back folds on lines the lint did not change. Whether a merge
// counts as the same definition, so its fold survives the edit, is a
// product choice.
//
// A "fold" is a definition, list item, or heading collapsed with the arrow
// in the margin; the plugin puts every fold back after a lint.
//
// Options:
//   (a) keep the fold on a definition the lint moved and merged into, so
//       it stays collapsed (recommended: the user folded that footnote,
//       and the merge only adds its duplicate's text to it);
//   (b) keep dropping it, as Obsidian does for any edit inside a fold.
// The test below takes option (a).
//
// Hunt 2026-10-06, cycle 4, lens diff. Cluster D3.
//
// Origin: pre-existing.
//
// Source of truth: manual sheet 12, "Lint triggers and settings page"
// ("every fold is still folded"); its note that Obsidian drops a fold on
// any edit inside it.

describe("spec question: a folded definition moved and merged into", () => {
    // Now: no fold at all (an empty list).
    it.fails("merge on: a folded definition moved to the bottom with a duplicate merged into it keeps its fold", () => {
        const before = ["Intro[^1]", "", "[^1]: alpha", "    cont", "", "Para.", "", "[^1]: beta", "", "More."].join("\n");
        const after = lintFootnotes(before, { mergeDuplicateDefinitions: true });
        expect(after.split("\n")).toEqual(["Intro[^1]", "", "Para.", "", "More.", "", "[^1]: alpha", "    cont", "    beta"]);
        expect(mapFoldLines([{ from: 2, to: 3 }], lineDiffChanges(before, after), before).map((f) => f.from)).toEqual([6]);
    });
});
