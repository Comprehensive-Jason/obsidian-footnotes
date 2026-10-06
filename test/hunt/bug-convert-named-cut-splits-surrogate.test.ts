import { describe, expect, it } from "vitest";

import { nameForBody } from "../../src/parsing/footnote-grammar";

// BUG (wrong output): with the Named footnote naming style, a long first
// word made of rare characters can be cut in half of one character.
//
// What the user would see: the footnote's text starts with a word longer
// than 30 units that holds characters from outside the basic plane (for
// example the math letters of "𝒜", or rare CJK characters). Converting
// inline footnotes to normal, or the reindex lint with Named on, cuts the
// name in the middle of such a character. The reference and the label get
// half a character, which shows as a replacement box, and once saved as
// UTF-8 it is turned into U+FFFD, the replacement character.
//
// Hunt 2026-10-02, round 2, lens convert. Cluster V5.
//
// Source of truth: Unicode. A lone surrogate (one half of a character that
// JavaScript stores as two units) is not a character, and a footnote name
// is made of characters.
//
// Cause: nameForBody cuts the name at 30 UTF-16 units, the units
// JavaScript counts in, rather than at 30 characters.
//
// Fix (2026-10-06): nameForBody cuts the name at 30 whole characters, so a
// character stored as two units is kept or dropped whole.

// Matches half of a two-unit character with its other half missing.
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("Named: the 30-unit cut of a long first word", () => {
    it("a name cut at 30 characters never splits a surrogate pair", () => {
        const body = "x" + "\u{1D49C}".repeat(20);
        const name = nameForBody(body, new Set()) ?? "";
        expect(name).not.toMatch(loneSurrogate);
    });
});
