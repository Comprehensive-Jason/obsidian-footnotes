import { describe, expect, it } from "vitest";

import { countEmptyFootnoteReferences } from "../../src/linting/lint-alerts";

// BUG (false alert): a link whose text is a single caret, "[^](https://x.y)",
// is counted as an unnamed footnote reference.
//
// What the user would see: the note links a caret symbol to a page, "see
// [^](https://x.y) here". The lint alert says the note has an unnamed
// footnote reference and says "Give it a name or delete it." It is
// a link, and Obsidian renders it as one.
//
// Hunt 2026-10-02, round 4, lens alerts. Cluster A6.
//
// Source of truth: CommonMark inline links ("[^]" followed by "(...)" is a
// link whose text is "^"); GFM footnotes need at least one character in a
// label, so "[^]" is never a footnote; countEmptyFootnoteReferences'
// docstring ("How many unnamed footnote references the note has").
//
// Severity: low. A false alert; nothing in the note changes.
//
// Cause: the count matches every "[^]" in the masked text without looking
// at what follows it.

describe("a link whose text is a caret", () => {
    it.fails("is not an unnamed footnote reference", () => {
        // Today: 1.
        expect(countEmptyFootnoteReferences("see [^](https://x.y) here")).toBe(0);
    });
});
