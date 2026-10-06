import { describe, expect, it } from "vitest";

import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";

// Settled behaviour: Fix lazy definitions leaves a lazy label alone when
// the blank line it would add changes how the lines after the label read,
// and the lazy-label alert keeps naming it.
//
// The note reads "1. one", "[^a]: lazy", "2. two". The label is lazy
// (Obsidian reads it as more of item 1's text). A blank line above it
// would make it a definition, but that definition would then swallow
// "2. two" (and any items after it) as more of its own text: a numbered
// item that does not start at 1 cannot break into a paragraph (CommonMark
// 0.31.2, section 5.3). So the fix is skipped and the note stays as it is.
// The lines that continue the label's own paragraph ("more text" under
// "Some prose", "[^1]: def") still become the definition's text, as the
// user meant; a line that starts a block of its own (the next list item)
// must read as before.
//
// This started as an open spec question from the hunt (2026-10-05, round
// 2, lens mix, cluster L13). Jason's triage decision Q7 (2026-10-05)
// settled it: skip the fix and let the lazy alert name the label.
//
// Source of truth: Jason's triage decision Q7, 2026-10-05; live Obsidian
// 1.14.4 (2026-10-05): "x[^a]", "", "1. one", "", "[^a]: lazy", "2. two",
// "3. three" has a definition of a on lines 4 to 6, which takes "2. two"
// and "3. three" as its text; ADR 0002 (docs/adr/0002-never-silent-lint.md).

/** The note reading's blocks for the first line that reads exactly `line` (lineBlocks: the blocks the line belongs to, a "^" marking where one starts). */
function blocksAt(text: string, line: string): string {
    const lines = text.replace(/\r/g, "").split("\n");
    return readNote(lines).lineBlocks[lines.findIndex((l) => l === line)];
}

describe("fix-lazy on a lazy label between two list items", () => {
    it("a lazy label between two numbered items is left lazy, and the alert names it", () => {
        const note = "x[^a]\n\n1. one\n[^a]: lazy\n2. two";
        expect(fixLazyDefinitions(note)).toBe(note);
        expect(blocksAt(note, "2. two")).toBe("list.ordered ^listItem ^paragraph");
        expect(lazyDefinitionLabelNames(note.split("\n"))).toEqual(["a"]);
    });

    it("between two bullet items, where the blank line would split the list in two, it is left lazy too", () => {
        const note = "x[^a]\n\n- one\n[^a]: lazy\n- two";
        expect(fixLazyDefinitions(note)).toBe(note);
    });

    it("control: the label's own paragraph lines still become the definition's text", () => {
        expect(fixLazyDefinitions("x[^1]\n\nSome prose\n[^1]: def\nmore text")).toBe("x[^1]\n\nSome prose\n\n[^1]: def\nmore text");
    });

    it("control: a lazy label after the last item is still fixed", () => {
        expect(fixLazyDefinitions("x[^1]\n\n1. one\n[^1]: def\n\nAfter.")).toBe("x[^1]\n\n1. one\n\n[^1]: def\n\nAfter.");
    });
});
