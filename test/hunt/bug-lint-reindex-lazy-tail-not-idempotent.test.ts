import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): on default settings, a lint that reorders the
// definitions can leave work for the next lint, so linting twice changes
// the note twice.
//
// What the user would see: the definitions read "[^1]: one", then
// "[^2]: two" with an unindented "lazy tail" line under it (a lazy
// continuation: a line that carries on the definition above without being
// indented). The note cites [^2] first, so the lint renumbers and swaps
// the two. Now "lazy tail" sits directly above "[^2]: one". The next lint
// adds a blank line between them, so a lint on save rewrites the note a
// second time. Reading view looks the same either way.
//
// Hunt 2026-10-02, round 2, lens properties. Cluster P5.
//
// Source of truth: the lint's idempotence promise (linter.ts comments;
// test/properties.test.ts, "lint is idempotent for every document and
// option combo", whose generator writes no unindented lazy tails).
//
// Cause: move-to-bottom keeps a blank line after a block that ends in a
// lazy continuation unless that block is the last one (Kimi hunt cycle 3,
// 2026-09-16). Reindex then swaps blocks between slots, so the lazy-tailed
// block can land in front of another label with no blank line between.

describe("reindex reorders a lazy-tailed definition in front of another label", () => {
    it.fails("default lint is idempotent", () => {
        const doc = "a[^2] b[^1]\n\n[^1]: one\n[^2]: two\nlazy tail";
        const once = lintFootnotes(doc);
        // Today once ends "[^1]: two\nlazy tail\n[^2]: one", and lint 2 adds a blank line before "[^2]: one".
        expect(lintFootnotes(once)).toBe(once);
    });
});
