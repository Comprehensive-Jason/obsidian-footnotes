import { describe, expect, it } from "vitest";

import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): with Merge duplicate definitions on, the merge adds
// a later copy's text under a first copy that is an empty label, and the
// paragraph straight under that label becomes the footnote's text.
//
// What the user would see: "[^a]:" alone on a line, "lazy tail" right
// under it, and a second definition "[^A]: alpha" further down. Ctrl+S
// writes "[^a]:", "    alpha", "lazy tail". Reading view now shows
// footnote a as "alpha lazy tail": a line of the user's prose has moved
// into the footnote and left the page.
//
// A "label" is the "[^a]:" head of a definition. A "lazy" line is one that
// carries on the paragraph above it without the indentation it would
// normally need.
//
// Hunt 2026-10-06, cycle 5, lens lint. Cluster X28.
//
// Origin: pre-existing.
//
// Source of truth: live Obsidian 1.14.4 (2026-10-06):
// "[^a]:\n    alpha\nlazy tail\n\nx[^a]" renders footnote a as
// "alpha lazy tail" (the paragraph joins the footnote). Before the merge,
// "[^a]:" with nothing after it is a definition of one line, and
// "lazy tail" a paragraph of its own (the settled empty-label rule).
//
// Cause: mergeDuplicateFootnoteDefinitions in
// src/linting/rules/merge-duplicate-definitions.ts checks that cutting the
// later copies leaves the other lines reading as before, and that the
// protected text is the same. It never checks the note after the text is
// added under the first copy, where the new indented line turns the
// paragraph under it into lazy text of the footnote.

/** Each definition as "name@first line-last line", the name in lower case. */
const defs = (text: string) => readNote(text.split("\n")).definitions.map((d) => `${d.name.toLowerCase()}@${d.start}-${d.end}`);

describe("the merge appends under an empty first copy with a paragraph straight under it", () => {
    const doc = "[^a]:\nlazy tail\n\n[^A]: alpha";

    it("control: before the merge, 'lazy tail' is outside every definition", () => {
        expect(defs(doc)).toEqual(["a@0-0", "a@3-3"]);
        expect(readNote(doc.split("\n")).definitionAt(1)).toBeNull();
    });

    // Now: "[^a]:\n    alpha\nlazy tail", and [^a] runs over lines 0 to 2.
    it.fails("after the merge, 'lazy tail' is still outside every definition", () => {
        const merged = mergeDuplicateFootnoteDefinitions(doc);
        const lines = merged.split("\n");
        const at = lines.indexOf("lazy tail");
        expect(at).toBeGreaterThanOrEqual(0);
        expect(readNote(lines).definitionAt(at), JSON.stringify(merged)).toBeNull();
    });
});
