import { describe, expect, it } from "vitest";

import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): merging away a duplicate definition that sits
// between two lists joins the two lists into one.
//
// What the user would see: [^a] is defined twice, and the second copy
// sits between two bullet lists. With Merge duplicate definitions on, the
// lint folds the second copy into the first and cuts it out. Only blank
// lines are then left between the lists, so they become one loose list,
// with more space between the items.
//
// Hunt 2026-10-05, round 2, lens mix. Cluster L12.
//
// Source of truth: Jason's decision (2026-10-05): two lists with only
// blank lines between them are one list, as Obsidian reads them, and a
// move that would join lists is skipped. bug-definition-between-lists-
// joins-them pins the same join for the default lint's move and notes
// that merging a duplicate shows it too.
//
// Cause: mergeDuplicateFootnoteDefinitions cuts the duplicate out with
// removeLineRanges and never asks linesReadDifferently, the guard the
// orphan rule, move-to-bottom, and Delete footnote everywhere use to
// leave a note alone when a cut would change how Obsidian reads the lines
// around it. (11198c4's message says the merge uses the same check; the
// merge rule has no such call.)

/** The note reading's blocks for the first line that reads exactly `line` (lineBlocks: the blocks the line belongs to, a "^" marking where one starts). */
function blocksAt(text: string, line: string): string {
    const lines = text.replace(/\r/g, "").split("\n");
    return readNote(lines).lineBlocks[lines.findIndex((l) => l === line)];
}

describe("merge between two lists", () => {
    it.fails("merging away a duplicate that sits between two lists keeps them apart", () => {
        const note = "x[^a]\n\n[^a]: first\n\n- one\n\n[^a]: second\n\n- two";
        const out = mergeDuplicateFootnoteDefinitions(note);
        // Today: "list ^listItem ^paragraph", "- two" continues the first list instead of starting one ("^list").
        expect(blocksAt(out, "- two")).toBe(blocksAt(note, "- two"));
    });
});
