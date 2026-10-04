// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 2 of 4 tests were red there and carry it.fails.
import { describe, expect, it } from "vitest";

import { invalidFootnoteNames, nestedFootnoteDefinitionNames } from "../../src/linting/lint-alerts";
import { readNote } from "../../src/parsing/note-reading";

// A user with a definition inside a blockquote or callout gets no warning
// from two of the lint alerts that exist to protect them:
//
// - "> [^my note]: x" (a quoted definition whose name Obsidian refuses) is
//   never reported by the invalid-name alert, while the same label at the
//   left margin is.
// - "> [^1]: see [^2]" (a footnote nested inside a quoted definition) is
//   never reported by the nested-footnote alert, while the same nesting at
//   the left margin is.
//
// The C22 ruling made quoted labels REAL definitions for the orphan rules:
// they are found, counted, deleted and reported there. The duplicate alert
// carves them out on purpose and SAYS so ("duplicates involving a quoted
// definition are neither merged nor reported here"). These two alerts carve
// them out silently: both iterate findDefinitionBlocks, which is column-0
// only, so a quoted definition is never inspected. The nested alert's own
// contract even covers the shape ("a live reference ... on the label line
// after the label itself").

const ctx = (markdown: string) => {
    const lines = markdown.split("\n");
    const reading = readNote(lines);
    const masked = [...readNote(lines).maskedLines()];
    const starts = readNote(lines).labelLines;
    return { lines, reading, masked, starts };
};

describe("the invalid-name alert covers quoted definitions", () => {
    it("a quoted definition with an invalid name is reported", () => {
        const { lines } = ctx("> [^my note]: x");
        expect(invalidFootnoteNames(lines)).toContain("my note");
    });

    it("control: a column-0 definition with an invalid name is reported", () => {
        const { lines } = ctx("[^my note]: x");
        expect(invalidFootnoteNames(lines)).toContain("my note");
    });
});

describe("the nested-footnote alert covers quoted definitions", () => {
    it("a footnote nested inside a quoted definition is reported", () => {
        const { lines } = ctx("> [^1]: see [^2]\n\nuse[^1] use2[^2]");
        expect(nestedFootnoteDefinitionNames(lines)).toContain("1");
    });

    it("control: a footnote nested inside a column-0 definition is reported", () => {
        const { lines } = ctx("[^1]: see [^2]\n\nuse[^1] use2[^2]");
        expect(nestedFootnoteDefinitionNames(lines)).toContain("1");
    });
});
