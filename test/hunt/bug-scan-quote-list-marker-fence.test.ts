import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { scanDocument } from "../../src/parsing/markdown-scan";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (wrong output on default settings): a code fence opened behind a
// quote and then a list marker, "> - ```", is not seen as a fence, and its
// closing line opens a phantom fence instead.
//
// What the user would see: a blockquote holds a list item that starts a
// code block, "> - ```", with ">   code [^5]" inside and ">   ```"
// closing it. Reading view shows code. The plugin reads "[^5]" as a live
// reference: the default lint renumbers it inside the code, to
// ">   code [^1]". The closing ">   ```" opens a fence that never closes,
// so the real text after it, "> after[^1]", is treated as code: the lint
// renames footnote 1's definition to "[^2]: d" but leaves the visible
// "[^1]", which now points at nothing.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X2.
//
// Source of truth: CommonMark (a fence can open inside a list item inside
// a blockquote) and Jason's 2026-08-10 ruling that text inside code is
// untouchable. The plugin already handles a fence behind a quote alone
// and behind a list marker alone.

describe("a fence behind a quote then a list marker ('> - ```')", () => {
    it.fails("the default lint never rewrites code inside a '> - ```' fence", () => {
        const doc = "> - ```\n>   code [^5]\n>   ```\n> after[^1]\n\n[^1]: d";
        // Today: "> - ```\n>   code [^1]\n>   ```\n> after[^1]\n\n[^2]: d".
        expect(lintFootnotes(doc)).toContain(">   code [^5]");
    });

    it.fails("the fence interior is protected", () => {
        const lines = "> - ```\n>   [^9]: fake\n>   ```\n\nreal[^1]\n\n[^1]: real".split("\n");
        expect(scanDocument(lines).isProtected.slice(0, 3)).toEqual([true, true, true]);
    });

    it.fails("code inside it reserves no number", () => {
        expect(computeNextFootnoteNumber("> - ```\n>   code [^5]\n>   ```")).toBe(1);
    });

    it.fails("the quoted line after its closer is not protected", () => {
        const lines = "> - ```\n>   code\n>   ```\n> after[^1]\n\n[^1]: d".split("\n");
        expect(scanDocument(lines).isProtected[3]).toBe(false);
    });
});
