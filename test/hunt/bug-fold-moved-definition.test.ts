import { describe, expect, it } from "vitest";

import { lineDiffChanges, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): a folded definition the default lint moves to the bottom
// of the note comes back unfolded.
//
// What the user would see: a definition "[^1]: alpha" with an indented
// second line "    continued alpha" sits in the middle of the note, and the
// user has folded it (Obsidian offers a fold on a line followed by more
// indented lines). They save; the lint moves the definition under the
// last paragraph. The definition arrives at the bottom unfolded, though
// the lint only moved it.
//
// Hunt 2026-10-06, cycle 3, lens diff. Cluster D2.
//
// Origin: regression (since cec4352, from fcd3970, the prose-first
// line-up), with a pre-existing general face: the cec4352 diff carried the
// fold to the definition's new place in the two short notes below, but a
// definition moved past enough prose lost its fold there too.
//
// Source of truth: manual sheet 12 ("Fold a heading and a bulleted list
// ... Ctrl+S: the note is linted, every fold is still folded"), and
// mapFoldLines's own contract ("A fold whose heading line was removed is
// dropped": a definition the lint moves is not removed). Obsidian offers
// this fold: its indent fold service (the "Fold indent" setting, on by
// default) folds a line followed by more-indented lines (the hunt's
// skeptic read it in Obsidian's app.js, 2026-10-06).
//
// Cause: since the prose-first line-up, alignLines in
// src/editor/document-diff.ts pairs prose lines first, and a definition
// the lint moves to the bottom is a deleted line plus an inserted one,
// so mapFoldLines finds no new line for the fold's start and drops it.

describe("a folded definition the lint moves to the bottom keeps its fold", () => {
    // Before the fix: [].
    it.fails("renamed on the way: the fold follows it to the bottom", () => {
        const before = ["Intro[^2]", "", "[^2]: alpha", "    continued alpha", "", "Lorem ipsum[^2]."].join("\n");
        const after = lintFootnotes(before, {});
        expect(after.split("\n")).toEqual(["Intro[^1]", "", "Lorem ipsum.[^1]", "", "[^1]: alpha", "    continued alpha"]);
        expect(mapFoldLines([{ from: 2, to: 3 }], lineDiffChanges(before, after), before)).toEqual([{ from: 4, to: 5 }]);
    });

    it.fails("not renamed: the fold follows it to the bottom", () => {
        const before = ["Intro[^1]", "", "[^1]: alpha", "    continued alpha", "", "Lorem ipsum."].join("\n");
        const after = lintFootnotes(before, {});
        expect(after.split("\n")).toEqual(["Intro[^1]", "", "Lorem ipsum.", "", "[^1]: alpha", "    continued alpha"]);
        expect(mapFoldLines([{ from: 2, to: 3 }], lineDiffChanges(before, after), before)).toEqual([{ from: 4, to: 5 }]);
    });

    // The general face (the skeptic's): the definition moves past three
    // paragraphs. The expected fold is read off the lint's own output.
    // Pre-existing: the cec4352 diff dropped this fold too.
    it.fails("moved past several paragraphs: the fold follows it to the bottom", () => {
        const before = ["Intro[^1]", "", "[^1]: alpha", "    continued alpha", "", "Lorem.", "", "Ipsum.", "", "Dolor."].join("\n");
        const after = lintFootnotes(before, {});
        const lines = after.split("\n");
        const from = lines.indexOf("[^1]: alpha");
        expect(lines[from + 1]).toBe("    continued alpha");
        expect(mapFoldLines([{ from: 2, to: 3 }], lineDiffChanges(before, after), before)).toEqual([{ from, to: from + 1 }]);
    });
});
