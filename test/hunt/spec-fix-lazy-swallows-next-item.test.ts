import { describe, expect, it } from "vitest";

import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";

// spec question: what should Fix lazy definitions do with a lazy label
// that sits between two items of a numbered list?
//
// What it does now: the note reads "1. one", "[^a]: lazy", "2. two". The
// label is lazy (Obsidian reads it as more of item 1's text). The fix
// adds a blank line above it, which makes it a definition, but that
// definition then swallows "2. two" (and any items after it) as more of
// its own text: the list loses its second item, and footnote a reads
// "lazy 2. two". No alert says so.
// What a user might expect: the footnote reads "lazy" and the list keeps
// "2. two" as its second item; or, if that cannot be done, the label is
// left lazy and the lazy-label alert says why.
// Why it is a question and not a bug: the fix does what it promises (a
// blank line above the label), and the swallowing is how Obsidian reads
// the result: a numbered item that does not start at 1 cannot break into
// a paragraph (CommonMark 0.31.2, section 5.3), so "2. two" continues the
// footnote's paragraph. A blank line after the label as well would end
// the footnote but start a new list at 2, splitting the list. Whether the
// fix should refuse here, and what it should say, is Jason's call.
//
// Hunt 2026-10-05, round 2, lens mix. Cluster L13.
//
// Source of truth: live Obsidian 1.14.4 (2026-10-05):
// "x[^a]", "", "1. one", "", "[^a]: lazy", "2. two", "3. three" has a
// definition of a on lines 4 to 6, which takes "2. two" and "3. three"
// as its text; ADR 0002 (docs/adr/0002-never-silent-lint.md).

/** The note reading's blocks for the first line that reads exactly `line` (lineBlocks: the blocks the line belongs to, a "^" marking where one starts). */
function blocksAt(text: string, line: string): string {
    const lines = text.replace(/\r/g, "").split("\n");
    return readNote(lines).lineBlocks[lines.findIndex((l) => l === line)];
}

describe("spec question: fix-lazy on a lazy label between two numbered items", () => {
    it.fails("a lazy label between two items: the fix does not swallow the next item into the footnote", () => {
        const note = "x[^a]\n\n1. one\n[^a]: lazy\n2. two";
        const out = fixLazyDefinitions(note);
        // Either the label is left lazy (the alert speaks), or "2. two" is still an item of the list.
        // Today: out is "x[^a]\n\n1. one\n\n[^a]: lazy\n2. two", and "2. two" reads "footnoteDefinition paragraph".
        expect(out === note || blocksAt(out, "2. two") === blocksAt(note, "2. two")).toBe(true);
    });
});
