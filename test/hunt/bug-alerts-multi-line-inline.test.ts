import { describe, expect, it } from "vitest";

import { countEmptyFootnoteReferences, nestedFootnoteDefinitionNames } from "../../src/linting/lint-alerts";

// BUG (annoyance): two lint alerts miss an inline footnote that runs over a line break.
//
// What the user would see: a "[^]" written inside an inline footnote over two lines
// ("a ^[x" / "y [^] z] w") draws the lint alert about an unfinished, unnamed footnote, though
// the "[^]" is text of the inline footnote's body, as it is on one line. And a definition
// holding an inline footnote over two lines ("[^1]: a ^[x" / "y] b") gets no alert about a
// footnote nested inside another, though one holding a one-line inline footnote does.
//
// An "inline footnote" is "^[text]" written in the line itself; Obsidian lets one run over the
// line breaks of its paragraph (2e58d86).
//
// Hunt 2026-10-05, round 2, lens reader. Cluster R4.
//
// Source of truth: the one-line behaviour of both alerts (the controls); an inline footnote
// over a line break is a fact of the note reading since 2e58d86.
//
// Cause: both alerts in src/linting/lint-alerts.ts ask one-line lookups of the note reading.
// countEmptyFootnoteReferences skips a "[^]" only when inlineNoteAt finds an inline footnote
// around it, and nestedFootnoteDefinitionNames looks for one with inlineNotesOn; both leave
// out an inline footnote that runs over a line break.

describe("lint alerts and an inline footnote over two lines", () => {
    it("control: a '[^]' inside a one-line inline footnote is its body's text, no abandoned placeholder", () => {
        expect(countEmptyFootnoteReferences("a ^[x [^] z] w")).toBe(0);
    });

    // Today: 1.
    it("a '[^]' inside an inline footnote over two lines is its body's text too", () => {
        expect(countEmptyFootnoteReferences("a ^[x\ny [^] z] w")).toBe(0);
    });

    it("control: a definition holding a one-line inline footnote gets the nesting alert", () => {
        expect(nestedFootnoteDefinitionNames(["see[^1]", "", "[^1]: a ^[x y] b"])).toEqual(["1"]);
    });

    // Today: [].
    it("a definition holding an inline footnote over two lines gets the nesting alert too", () => {
        expect(nestedFootnoteDefinitionNames(["see[^1]", "", "[^1]: a ^[x", "y] b"])).toEqual(["1"]);
    });
});
