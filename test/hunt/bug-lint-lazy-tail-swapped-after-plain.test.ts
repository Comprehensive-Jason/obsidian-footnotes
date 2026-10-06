import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): the default lint takes two runs to settle a note whose
// definition with a lazy tail comes before a plain one it is renumbered
// after.
//
// What the user would see: "a[^1] b[^2]", then "[^2]: two" with an
// unindented second line "lazy tail", then "[^1]: one". The first save
// renumbers and gives "[^1]: one", a blank line, "[^2]: two", "lazy tail".
// The second save, with nothing typed in between, takes that blank line
// out again. Each lint is meant to leave the note settled.
//
// A "lazy tail" is a definition's last line written without indentation;
// Obsidian still reads it as the definition's text.
//
// Hunt 2026-10-06, cycle 3, lens lint. Cluster L1.
//
// Origin: pre-existing (cec4352 gives the same two outputs). Pin
// bug-lint-reindex-lazy-tail-not-idempotent covers the reverse face (a
// lazy block swapped in front of a label).
//
// Source of truth: the lint's promise to settle a note in one run
// (lintNote's docstring; test/properties.test.ts "lint is idempotent for
// every document and option combo").
//
// Cause: Move to bottom packs the gathered definitions label to label,
// except that a block ending in a lazy line gets a blank line after it
// (endsInLazyLine in src/linting/rewrite-document.ts). Reindex then swaps
// the blocks between their slots, but the blank line stays where it was:
// the block swapped into the lazy block's old slot is a plain one-line
// definition, and the blank line now sits after it. The next lint's move
// packs again and drops that blank line.

describe("reindex leaves a lazy block's blank line behind in the slot it came from", () => {
    // Once: "a[^1] b[^2]" / "" / "[^1]: one" / "" / "[^2]: two" / "lazy tail".
    // Twice: the blank line between the two definitions is gone.
    it("default lint is idempotent: a lazy-tailed definition swapped after a plain one", () => {
        const doc = "a[^1] b[^2]\n\n[^2]: two\nlazy tail\n\n[^1]: one";
        const once = lintFootnotes(doc);
        expect(lintFootnotes(once)).toBe(once);
    });

    it("three definitions, the lazy one first", () => {
        const doc = "a[^1] b[^2] c[^3]\n\n[^3]: three\nlazy tail\n\n[^2]: two\n[^1]: one";
        const once = lintFootnotes(doc);
        expect(lintFootnotes(once)).toBe(once);
    });

    it("control: with the lazy definition already last, one lint settles it", () => {
        const doc = "a[^1] b[^2]\n\n[^1]: one\n[^2]: two\nlazy tail";
        const once = lintFootnotes(doc);
        expect(lintFootnotes(once)).toBe(once);
    });
});
