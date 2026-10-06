import { describe, expect, it } from "vitest";

import { lineDiffChanges, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): a folded list item loses its fold when the lint
// rewrites it in place right under a definition the lint moves away.
//
// What the user would see: a definition sits above a list, and the
// list's first item, "- item^[note].", is folded over its children. The
// default lint moves the definition to the bottom and puts the inline
// footnote after the full stop ("- item.^[note]"). Afterwards the item is
// open again.
//
// Hunt 2026-10-05, round 2, lens diff. Cluster D5 (the list half; a
// heading inside a callout was dropped, since Obsidian cannot fold
// "> # heading").
//
// Source of truth: mapFoldLines' contract in document-diff.ts ("a line
// rewritten in place is still the same line ... A fold whose heading line
// was removed is dropped"); manual sheet 12 ("every fold is still folded"
// after a rewrite); FoldRange in the same file, which takes a fold on "the
// heading (or list item) line".
//
// Cause: the removed definition, the blank line under it, and the
// rewritten item make one run of lines that do not match. Inside a run,
// alignRun pairs old and new lines by position from the top, so the
// removed definition is paired with the rewritten item and the item
// itself counts as removed, which drops its fold. The fix for the same
// shape under a heading (bug-convert-fold-dropped-under-converted-
// definitions) lines up headings first; a list item is no heading, so it
// got no such help.
//
// Fix: every line is now lined up by its text with its footnotes taken
// out, inline footnotes included (lineKey in document-diff.ts), so
// "- item^[note]." and "- item.^[note]" are the same line, and the item is
// lined up with itself instead of with the removed definition.

describe("default lint: a folded list item rewritten in place right under a definition the lint moves away", () => {
    it("the list fold stays on its item", () => {
        const before = [
            "Intro[^1]", // 0
            "",
            "[^1]: alpha", // 2
            "",
            "- item^[note].", // 4, folded over its children
            "  - child",
            "  - child two",
            "",
            "tail",
        ].join("\n");
        const after = lintFootnotes(before, {});
        const item = after.split("\n").indexOf("- item.^[note]");
        expect(item).toBe(2);
        // Before the fix: [] (the fold was dropped).
        expect(mapFoldLines([{ from: 4, to: 6 }], lineDiffChanges(before, after), before)).toEqual([{ from: item, to: item + 2 }]);
    });
});
