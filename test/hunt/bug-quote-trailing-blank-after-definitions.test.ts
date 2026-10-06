import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { removeLineRanges } from "../../src/parsing/line-edits";

// BUG (annoyance): a note ending in a quote whose last line is a bare ">"
// takes two lints to settle, and a note whose definitions already sit
// under such a quote is changed by the lint.
//
// What the user would see: "a[^1]", then "[^1]: def", then a quote "> q"
// whose last line is ">". The first Ctrl+S moves the definition below the
// quote and keeps the ">". The second Ctrl+S, with nothing edited, deletes
// the ">". A note that already has its definitions at the bottom under
// such a quote loses the ">" on its first lint.
//
// "Idempotent" means that running the lint a second time changes nothing:
// lint(lint(note)) equals lint(note).
//
// Hunt 2026-10-06, cycle 5, lens lint. Cluster X30.
//
// Origin: pre-existing.
//
// Source of truth: the idempotence property of the lint pipeline
// (attack-surface.md, properties: f(f(doc)) === f(doc)); a lint with
// nothing to gather leaves the note as it is.
//
// Cause: removeLineRanges in src/parsing/line-edits.ts drops a blank quote
// line left at the end of the note (endsInQuoteBlankLine), but only when a
// cut reaches the end of the note. The first lint cuts the definition
// above the quote, so the ">" stays. The second lint cuts the definition
// that now ends the note, so the ">" above it goes.

describe("a quote's trailing blank line after the definitions", () => {
    const doc = "a[^1]\n\n[^1]: def\n\n> q\n>";

    // Now: once = "a[^1]\n\n> q\n>\n\n[^1]: def", twice = "a[^1]\n\n> q\n\n[^1]: def".
    it("the default lint is idempotent", () => {
        const once = lintFootnotes(doc);
        expect(lintFootnotes(once, {})).toBe(once);
    });

    // Now: "a[^1]\n\n> q\n\n[^1]: def".
    it("a note with its definitions already at the bottom under such a quote is left alone", () => {
        const gathered = "a[^1]\n\n> q\n>\n\n[^1]: def";
        expect(lintFootnotes(gathered)).toBe(gathered);
    });

    // Added with the fix, to keep what the old code did right: blank quote
    // lines that sit right above a cut at the end of the note are left
    // there by the cut, so they still go, a run of two included.
    it("blank quote lines right above a quoted definition cut from the end still go", () => {
        expect(removeLineRanges(["> q", ">", "> [^1]: d"], [{ start: 2, end: 2 }])).toEqual(["> q"]);
        expect(removeLineRanges(["> q", ">", ">", "> [^1]: d"], [{ start: 3, end: 3 }])).toEqual(["> q"]);
    });
});
