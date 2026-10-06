import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { protectedTextAlike } from "../../src/linting/rewrite-document";
import { readNote } from "../../src/parsing/note-reading";

// BUG (annoyance): a definition at the end of the note whose last line is
// a "%%" holds back reindex's reordering and the duplicate merge, though
// moving it changes nothing a reader would see.
//
// What the user would see: "Text[^2] and[^1].", then "[^1]: one" and
// "[^2]: two" with a "%%" line under the last one. Ctrl+S renumbers the
// footnotes but leaves the definitions out of order, every time. With
// Merge duplicate definitions on, a note whose last copy of [^a] ends in
// such a "%%" line needs two lints to merge, and the duplicate alert says
// nothing after the first.
//
// "Protected text" is text the plugin must never edit or read footnotes
// from: code, math, and comments. A "%%" line under a definition's text
// is that definition's lazy last line (a "lazy" line carries on the
// paragraph above it without the indentation it would normally need).
//
// Hunt 2026-10-06, cycle 5, lens lint. Cluster X32.
//
// Origin: regression (bb3f729). Before it, reindex and the merge both went
// through.
//
// Source of truth: live Obsidian 1.14.4 (2026-10-06): in
// "Text[^1] and.[^2]\n\n[^1]: two\n%%\n\n[^2]: one" both definitions exist
// and render ("two", "one"), and nothing is hidden, so the swapped form
// reads fine.
//
// Cause: protectedTextAlike in src/linting/rewrite-document.ts compares the
// sorted protected and comment lines of the note before and after,
// blank lines included. The note reading counts the blank line after a
// definition-ending "%%" as part of its comment span only when lines
// follow it. At the end of the note there is no such blank line; moved up
// the note, there is one, so the check says the protected text changed.
// Reindex then refuses its swap, and the merge refuses the name.

/** The note's definition names, in order. */
const names = (text: string): string[] => readNote(text.split("\n")).definitions.map((d) => d.name);

describe("a lazy %% tail blocks the merge and the reindex swap", () => {
    // Now: false.
    it("the root: protectedTextAlike says a %% tail moved up the note changed the protected text", () => {
        const before = "Text[^1] and[^2].\n\n[^2]: one\n[^1]: two\n%%".split("\n");
        const after = "Text[^1] and[^2].\n\n[^1]: two\n%%\n\n[^2]: one".split("\n");
        // Every definition reads the same in both: names, containers, and lines.
        expect(readNote(after).definitions.map((d) => after.slice(d.start, d.end + 1).join("|")).sort()).toEqual(
            readNote(before).definitions.map((d) => before.slice(d.start, d.end + 1).join("|")).sort(),
        );
        expect(protectedTextAlike(before, after)).toBe(true);
    });

    // Now: ["2", "1"]. At 4572859: "Text[^1] and[^2].\n\n[^1]: two\n%%\n\n[^2]: one".
    it("reindex puts the definitions in reference order when the last one ends in a %% line", () => {
        const out = reindexFootnotes("Text[^2] and[^1].\n\n[^1]: one\n[^2]: two\n%%");
        expect(names(out)).toEqual(["1", "2"]);
    });

    // Now: the first lint only moves the copies to the bottom,
    // "Text[^a]\n\nMiddle\n\n[^a]: one\n[^a]: two\n%%", and the second
    // merges them into "[^a]: one", "    two", "%%". The duplicate alert
    // says nothing in between, since by then the merge would go through.
    it("merge on: the lint settles a note whose last copy ends in a %% line", () => {
        const note = "Text[^a]\n\n[^a]: one\n\nMiddle\n\n[^a]: two\n%%";
        const once = lintFootnotes(note, { mergeDuplicateDefinitions: true });
        expect(lintFootnotes(once, { mergeDuplicateDefinitions: true })).toBe(once);
    });
});
