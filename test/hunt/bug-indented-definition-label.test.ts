import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { definitionLabelIn } from "../../src/parsing/label-shapes";
import { readNote } from "../../src/parsing/note-reading";

// BUG (review A2, Jason confirmed live 2026-09-08): DefinitionStart was
// anchored at column 0, so a definition label indented 1 to 3 spaces
// ("  [^1]: indented") was invisible as a label. referenceOccurrences
// still saw "[^1]" as a mid-line reference followed by a colon, the
// punctuation rule swapped them into "  :[^1] indented", and with
// "Delete orphaned references" on the lint deleted the reference AND
// the label. Ground truth in Obsidian's Reading view (2026-09-09): 1 to 3
// leading spaces render as a footnote definition, even directly under
// another definition (that starts a NEW footnote, not a continuation);
// 4 spaces is indented code; the same holds after a blockquote marker.

describe("a definition label indented 1 to 3 spaces is a definition", () => {
    it("definitionLabelIn reads it, and stops at four spaces", () => {
        expect(definitionLabelIn("  [^1]: x")).toEqual({
            nameStart: 4,
            nameEnd: 5,
            labelEnd: 7,
            quoted: false,
        });
        expect(definitionLabelIn("   [^ab]: x")?.nameStart).toBe(5);
        expect(definitionLabelIn("    [^1]: x")).toBeNull();
        expect(definitionLabelIn(">  [^1]: x")).toEqual({
            nameStart: 5,
            nameEnd: 6,
            labelEnd: 8,
            quoted: true,
        });
    });

    it("an indented label directly under a definition starts a new block", () => {
        const lines = ["[^1]: one", "  [^2]: two", "    more"];
        expect(readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([
            { name: "1", start: 0, end: 0 },
            { name: "2", start: 1, end: 2 },
        ]);
    });

    it("the punctuation rule leaves the label alone", () => {
        const doc = "a[^1]\n\n  [^1]: indented";
        expect(footnoteAfterPunctuation(doc)).toBe(doc);
    });

    it("orphan-reference deletion keeps a reference whose definition is indented", () => {
        const doc = "a[^1]\n\n  [^1]: indented";
        expect(lintFootnotes(doc, { removeOrphanedReferences: true })).toBe(doc);
    });

    it("reindex renames indented labels in place, indentation kept", () => {
        expect(reindexFootnotes("b[^2] a[^1]\n\n  [^1]: one\n  [^2]: two")).toBe(
            "b[^1] a[^2]\n\n  [^1]: two\n  [^2]: one",
        );
    });
});
