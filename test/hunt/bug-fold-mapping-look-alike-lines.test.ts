import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): after a lint, a folded heading in a note whose
// definitions read alike (many "Ibid.") comes back unfolded, and a fold
// lands on another section's paragraph instead.
//
// What the user would see: a note with three sections, each citing
// footnotes whose definitions sit in the section and mostly read
// "Ibid.". The user folds "# S1". After a lint with the default
// settings, "# S1" is open again, and the fold sits on S2's paragraph
// instead, hiding it. In a second pane on the same note, a caret on
// "# S1" lands on S2's paragraph.
//
// Hunt 2026-10-05, round 1, lens properties. Cluster PR2. Found by a
// property over realistic notes: a heading folded over its section comes
// back folded over that heading's section in the linted note.
//
// Source of truth: mapFoldLines' own contract in document-diff.ts ("a
// line rewritten in place is still the same line, a line above an
// insertion or deletion stays, a line below one shifts"; a heading's fold
// ends before the next heading of the same or a higher level); manual
// sheet 12 ("every fold is still folded" after a lint). Obsidian's
// applyFoldInfo refolds each fold by asking for the fold range of the
// line at the mapped `from`, so a `from` on a paragraph line folds
// nothing there and the heading comes back unfolded.
//
// Cause: alignLines (which mapFoldLines and lineMapper share) matches
// old and new lines with their footnote names stripped, through a
// longest-common-run search. With names stripped, the blank lines and
// the many ": Ibid." lines match each other better than the headings
// do, so the headings are paired with the wrong lines.

const IBID_NOTE = [
    "# S0", // 0
    "",
    "Text of section 0[^1][^2][^3].",
    "",
    "[^1]: Ibid.",
    "",
    "[^2]: Ibid.",
    "",
    "[^3]: Ibid.",
    "",
    "# S1", // 10
    "",
    "[^4]: Ibid.",
    "[^5]: Ibid.",
    "[^6]: Ibid.",
    "",
    "Text of section 1[^4][^5][^6].",
    "", // 17
    "# S2", // 18
    "",
    "[^7]: Ibid.",
    "",
    "Text of section 2[^7].",
].join("\n");

describe("a folded section in a note whose definitions read alike once their names are stripped", () => {
    it("the default lint gives the fold back to its own heading, over its own section", () => {
        const after = lintFootnotes(IBID_NOTE, {});
        const lines = after.split("\n");
        expect(lines.slice(0, 11)).toEqual([
            "# S0",
            "",
            "Text of section 0.[^1][^2][^3]",
            "",
            "# S1",
            "",
            "Text of section 1.[^4][^5][^6]",
            "",
            "# S2",
            "",
            "Text of section 2.[^7]",
        ]);
        // "# S1" was folded over lines 10 to 17; it is line 4 now, and its
        // section runs to line 7. Today: [{ from: 10, to: 14 }], a fold that
        // starts on S2's paragraph and hides it and three definitions, while
        // S1 comes back open.
        expect(mapFoldLines([{ from: 10, to: 17 }], lineDiffChanges(IBID_NOTE, after), IBID_NOTE)).toEqual([{ from: 4, to: 7 }]);
    });

    it("another pane's caret on the folded heading follows the heading", () => {
        const after = lintFootnotes(IBID_NOTE, {});
        // Today: 10, S2's paragraph.
        expect(lineMapper(lineDiffChanges(IBID_NOTE, after), IBID_NOTE)(10)).toBe(4);
    });
});
