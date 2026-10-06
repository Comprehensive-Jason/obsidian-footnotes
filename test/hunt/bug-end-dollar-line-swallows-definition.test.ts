import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (data loss, with "Delete orphaned references" on): a "$$" line at
// the very end of a note, part of the last definition's text, is moved by
// the lint to a place where lines follow it, and there it opens a math
// block that swallows the definition below.
//
// What the user would see: "Text[^2] and[^1].", then "[^1]: one", "[^2]:
// two", "$$" as the note's last line. The default lint renumbers and swaps
// the definitions: "[^1]: two", "$$", a blank line, "[^2]: one". Reading
// view now shows everything after "$$" as a math block, so [^2] has no
// definition and its reference shows as plain text. With "Delete orphaned
// references" on, the next save deletes "[^2]" from the text. With "Merge
// duplicate definitions" on, a duplicate ending in "$$" is merged into the
// first copy, the "$$" comes along, and the paragraph after the first copy
// turns into math.
//
// A "$$" line opens a display math block that runs to the next "$$" line,
// or to the end of the note. A "$$" that is the note's very last line, with
// nothing after it, opens nothing: it is just more text of the definition
// above.
//
// Hunt 2026-10-06, cycle 4, lens lint. Cluster L2.
//
// Origin: pre-existing.
//
// Source of truth: live Obsidian 1.14.4: "Text[^1] and.[^2]", "",
// "[^1]: two", "$$", "", "[^2]: one" draws a math block over lines 3 to 5
// and leaves [^2] undefined; remark-math (a math fence opens only when a
// line break follows it); docs/obsidian-reading-rules.md E1 and M2; the
// lint's promise that it never turns a footnote's reference dead.
//
// Cause: reindex's slot swap (src/linting/rules/re-index-footnotes.ts)
// and the duplicate merge (src/linting/rules/merge-duplicate-definitions.ts)
// carry a definition's lines, its trailing "$$" included, to a place where
// other lines follow. Neither checks that the note still reads the same
// definitions afterwards; the move-to-bottom rule does (it counts the
// definitions after its move).

/** The names of the footnotes the note defines, sorted. */
const defined = (text: string) => readNote(text.split("\n")).definitions.map((d) => d.name).sort();

/** How many lines of the note are protected text (math, code, comments). */
const protectedCount = (text: string) => readNote(text.split("\n")).protectedLines.filter(Boolean).length;

describe("a definition ending in an end-of-note '$$' line, moved by the lint", () => {
    const doc = "Text[^2] and[^1].\n\n[^1]: one\n[^2]: two\n$$";

    it("control: the note defines both footnotes and protects nothing", () => {
        expect(defined(doc)).toEqual(["1", "2"]);
        expect(protectedCount(doc)).toBe(0);
    });

    // Now: only [^1] is defined.
    it.fails("the default lint keeps both definitions defined", () => {
        expect(defined(lintFootnotes(doc, {}))).toEqual(["1", "2"]);
    });

    // Now: "Text[^1] and." with [^2] deleted.
    it.fails("the default lint, then a lint deleting orphaned references, keeps every reference", () => {
        const once = lintFootnotes(doc, {});
        const twice = lintFootnotes(once, { removeOrphanedReferences: true });
        expect(readNote(twice.split("\n")).references.filter((r) => r.live).length).toBe(2);
    });

    // Now: "[^a]: one", "    two", "$$", "", "middle": "middle" is math.
    it.fails("the merge keeps the paragraph after the first copy out of math", () => {
        const dup = "Text[^a]\n\n[^a]: one\n\nmiddle\n\n[^a]: two\n$$";
        const out = mergeDuplicateFootnoteDefinitions(dup);
        const lines = out.split("\n");
        const reading = readNote(lines);
        const middle = lines.indexOf("middle");
        expect(middle).toBeGreaterThan(-1);
        expect(reading.protectedLines[middle]).toBe(false);
    });
});
