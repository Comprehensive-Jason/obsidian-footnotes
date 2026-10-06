import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../../src/linting/linter";

// BUG (annoyance): with Delete orphaned definitions on, a lazy label under
// a list item takes two lints to settle.
//
// What the user would see: "- item", then a lazy label "[^n]: outer"
// right under it, a blank line, and an indented "    [^m]: inner" that
// nothing references. The first save deletes [^m] and leaves [^n] lazy,
// and the lazy-label alert names [^n]. The second save, with nothing typed
// in between, fixes [^n] (and deletes it too when nothing references it).
// One lint should have done both.
//
// A "lazy label" is a "[^n]:" line with no blank line above it, so
// Obsidian reads it as the text of the paragraph or list item above, not
// as a definition.
//
// Hunt 2026-10-06, cycle 3, lens lint. Cluster L2.
//
// Origin: regression (since cec4352, from e030cac). At cec4352 fix-lazy
// inserted the blank line in the first lint and the result was stable: the
// referenced case gave "Text.[^n]" / "" / "- item" / "" / "[^n]: outer" on
// the first lint and the same on the second.
//
// Source of truth: the lint's promise to settle a note in one run
// (lintNote's docstring; test/properties.test.ts "lint is idempotent for
// every document and option combo"). Jason's decision Q7 (2026-10-05)
// decides what one lint does, not that it takes two.
//
// Cause: since e030cac (Q7), fixLazyDefinitions in
// src/linting/rules/fix-lazy-definitions.ts skips a lazy label whose blank
// line would change how the lines after it read: here the blank line would
// pull the indented "[^m]:" into [^n]'s definition. But fix-lazy runs
// before the orphan rule, which then deletes [^m]. The reason for the skip
// is gone, so the next lint inserts the blank line.

const deleteOrphans: LintOptions = { removeOrphanedDefinitions: true };

describe("fix-lazy's skip is decided before the orphan rule removes its cause", () => {
    // Once: "Text." / "" / "- item" / "[^n]: outer". Twice: "Text." / "" / "- item".
    it.fails("a lazy label nothing references, over an orphaned in-item definition: lint twice is lint once", () => {
        const doc = "Text.\n\n- item\n[^n]: outer\n\n    [^m]: inner";
        const once = lintFootnotes(doc, deleteOrphans);
        expect(lintFootnotes(once, deleteOrphans)).toBe(once);
    });

    // Once: "Text.[^n]" / "" / "- item" / "[^n]: outer".
    // Twice: "Text.[^n]" / "" / "- item" / "" / "[^n]: outer".
    it.fails("a referenced lazy label: lint twice is lint once", () => {
        const doc = "Text[^n].\n\n- item\n[^n]: outer\n\n    [^m]: inner";
        const once = lintFootnotes(doc, deleteOrphans);
        expect(lintFootnotes(once, deleteOrphans)).toBe(once);
    });

    it.fails("a numbered item that does not start at 1: lint twice is lint once", () => {
        const doc = "Text.\n\n3. three\n[^n]: outer\n\n    [^m]: inner";
        const once = lintFootnotes(doc, deleteOrphans);
        expect(lintFootnotes(once, deleteOrphans)).toBe(once);
    });
});
