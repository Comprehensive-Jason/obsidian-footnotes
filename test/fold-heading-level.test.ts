import { describe, expect, it } from "vitest";

import { lineDiffChanges, mapFoldLines } from "../src/editor/document-diff";
import { lintFootnotes } from "../src/linting/linter";

// Jason's report (sheet 12, 2026-10-04): with "Lint on save" and a footnote
// section heading on, he folded the note's last heading, a level 2 one,
// and saved. The lint gathered the definitions at the bottom under a new
// "# Footnotes" heading, and they came back folded inside the level 2
// heading's fold, new heading and all.
//
// What Obsidian does: a heading's fold is its section, which runs to the
// line before the next heading of the same level or a higher one (a level
// 1 heading ends a level 2 section; a level 3 heading does not). The fold
// was put back with its last line carried to the new end of the note,
// because the note's last line (the empty one after the final newline)
// still sits at the end, below everything the lint added.

const BEFORE = [
    "# Sheet",
    "",
    "start messy[^20] references[^10] here",
    "",
    "[^20]: twenty, used first",
    "[^10]: ten, used second",
    "",
    "## Lint on save",
    "",
    "- [ ] a check",
    "",
    "## The Linting settings page",
    "",
    "- [ ] another check",
    "- [ ] the last check",
    "",
].join("\n");

/** The fold of the last heading, from its line to the note's last line, as Obsidian reports a section that runs to the end. */
const LAST_SECTION_FOLD = { from: 11, to: 15 };

function foldsAfterLint(sectionHeading: string): { lines: string[]; folds: { from: number; to: number }[] } {
    const after = lintFootnotes(BEFORE, { sectionHeading });
    const folds = mapFoldLines([LAST_SECTION_FOLD], lineDiffChanges(BEFORE, after), BEFORE);
    return { lines: after.split("\n"), folds };
}

describe("a folded section at the end of the note, after the lint adds a footnote section heading", () => {
    it("ends before a new heading of a higher level", () => {
        const { lines, folds } = foldsAfterLint("# Footnotes");
        const heading = lines.indexOf("# Footnotes");
        expect(heading).toBeGreaterThan(LAST_SECTION_FOLD.from);
        expect(folds).toEqual([{ from: lines.indexOf("## The Linting settings page"), to: heading - 1 }]);
    });

    it("ends before a new heading of the same level", () => {
        const { lines, folds } = foldsAfterLint("## Footnotes");
        const heading = lines.indexOf("## Footnotes");
        expect(folds).toEqual([{ from: lines.indexOf("## The Linting settings page"), to: heading - 1 }]);
    });

    it("control: still takes in a new heading of a lower level, which belongs to its section", () => {
        const { lines, folds } = foldsAfterLint("### Footnotes");
        expect(folds).toEqual([{ from: lines.indexOf("## The Linting settings page"), to: lines.length - 1 }]);
    });
});
