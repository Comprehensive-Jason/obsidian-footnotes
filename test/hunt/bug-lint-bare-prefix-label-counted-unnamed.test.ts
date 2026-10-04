import { describe, expect, it } from "vitest";

import { countEmptyFootnoteReferences } from "../../src/linting/lint-alerts";

// BUG (wrong alert): the count of unnamed footnote references also counts
// a definition label that is just the note's prefix, such as "[^3.]:".
//
// What the user would see: the note's prefix is "3." and it holds
// "x[^3.]" with the definition "[^3.]: body", one unnamed footnote. The
// alert counts two. With the reference gone and only "[^3.]: body" left,
// the label alone still raises the unnamed-reference alert ("Give it a name
// or delete it") next to the orphan alert, which says to add a reference:
// two alerts with opposite advice for one line.
//
// Hunt 2026-10-02, round 4, lens alerts. Cluster A5.
//
// Source of truth: countEmptyFootnoteReferences' docstring ("How many
// unnamed footnote references the note has"); CONTEXT.md (a label is part
// of a definition, not a reference).
//
// Severity: low. A wrong count and a contradictory alert; nothing in the
// note changes.
//
// Cause: countEmptyFootnoteReferences counts every "[^]" and bare-prefix
// match in the masked text and never asks which lines start a definition.
//
// Fixed 2026-10-03 (the runtime swap, step 3): the bare prefix is counted
// among the live references the note reading finds, and a label is none.

const FRONTMATTER = "---\nfootnote-prefix: 3.\n---\n";

describe("the unnamed-reference count and a bare-prefix definition label", () => {
    it("one bare-prefix reference and its definition are ONE unnamed reference", () => {
        // Today: 2.
        expect(countEmptyFootnoteReferences(`${FRONTMATTER}x[^3.]\n\n[^3.]: body\n`, "3.")).toBe(1);
    });

    it("a bare-prefix definition with no reference is not an unnamed reference", () => {
        // Today: 1.
        expect(countEmptyFootnoteReferences(`${FRONTMATTER}x\n\n[^3.]: body\n`, "3.")).toBe(0);
    });
});
