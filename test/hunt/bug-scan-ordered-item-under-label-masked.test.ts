import { describe, expect, it } from "vitest";

import { scanDocument } from "../../src/parsing/markdown-scan";

// BUG (wrong output): a line like "10.      y" directly under a label line
// is read as code, so a reference on it is dead to the plugin.
//
// What the user would see: the definition "[^1]: x" is followed directly
// by "10.      y [^2]". A list item numbered other than 1 cannot interrupt
// a paragraph, so the line simply carries on footnote 1's text, and
// "[^2]" shows as a footnote. The plugin reads the line as an indented
// code block (the wide gap after "10." looks like code indentation), so
// "[^2]" is ignored: it reserves no number and the lint does not count it.
// Directly under plain prose the same line is already read correctly.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X7.
//
// Source of truth: CommonMark 5.2 (only a list starting at 1 can interrupt
// a paragraph) and the GLM hunt cycle 10 fact that "10.      y" under
// prose is paragraph text.
//
// Cause: after a label line the scanner sets prevParagraph to false, so it
// lets the line open a list item, whose wide gap then reads as code.

describe("'10.      y' directly under a label line", () => {
    it("is the footnote's lazy body ('10.' cannot interrupt a paragraph), not code", () => {
        const scan = scanDocument("[^1]: x\n10.      y [^2]\n\nu[^1]\n\n[^2]: two".split("\n"));
        expect(scan.isProtected[1]).toBe(false);
    });
});
