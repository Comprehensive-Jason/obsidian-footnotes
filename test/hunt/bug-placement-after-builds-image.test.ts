import { describe, expect, it } from "vitest";

import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): with footnote placement "after" (the default), the
// lint moves a reference over a "!" that is directly followed by "(...)",
// and the result is an image, not a footnote.
//
// What the user would see: the line reads "It was free[^1]!(sic)". The
// lint rewrites it to "It was free![^1](sic)". Markdown reads "![^1](sic)"
// as an image with the address "sic", so Reading view shows a broken
// image and footnote 1 has lost its only reference. With Delete orphaned
// definitions on, the next lint deletes footnote 1's text too.
//
// Hunt 2026-10-02, round 2, lens placement. Cluster L7.
//
// Source of truth: the punctuation rule's docstring (it moves a reference
// to the other side of the punctuation, never turns it into something
// else) and spec-image-alt-reference (resolved in Reading view
// 2026-09-16: a reference inside an image's alt text is dead).
//
// Fixed 2026-10-05 with round 2's cluster P10 (pin
// bug-punctuation-steps-over-bracket): the rule makes a move only if every
// footnote on the line is still a footnote after it.

// The names of the live references on `line` of `text`, as the plugin reads them.
function liveNames(text: string, line = 0): string[] {
    const lines = text.split("\n");
    return readNote(lines).referencesOn(line).map((o) => o.name);
}

describe("after: the move never builds an image out of a '!' and a '(...)'", () => {
    it("lint: It was free[^1]!(sic) keeps a live [^1]", () => {
        const out = footnoteAfterPunctuation("It was free[^1]!(sic)\n\n[^1]: x", "after");
        // Before the fix out started "It was free![^1](sic)", and [^1] is no longer live.
        expect(liveNames(out)).toEqual(["1"]);
    });
});
