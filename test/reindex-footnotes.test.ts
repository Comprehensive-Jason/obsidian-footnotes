import { describe, expect, it } from "vitest";

import { reindexFootnotes } from "../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../src/linting/rules/remove-orphaned-definitions";

// The full spec of the reindex algorithm, pinned as tests. Policy decisions
// made here (and nowhere else):
//   - numbered footnotes are renumbered 1..n by FIRST REFERENCE APPEARANCE
//   - named footnotes keep their names and never consume a number
//   - definitions are reordered to match appearance order; named ones slot
//     into the same ordering
//   - references with no definition still take part in the renumbering
//   - orphaned definitions are KEPT (never delete user content) and get the
//     numbers after all referenced footnotes, in definition order
//   - anything inside fenced code blocks, inline code, or frontmatter
//     neither counts nor gets rewritten
//   - a definition owns its indented continuation lines (including blank
//     lines followed by indented content) - they move with it

describe("reindexFootnotes", () => {
    it("returns a document with no footnotes unchanged", () => {
        const text = "plain prose\n\nwith two paragraphs";
        expect(reindexFootnotes(text)).toBe(text);
    });

    it("returns the empty string unchanged", () => {
        expect(reindexFootnotes("")).toBe("");
    });

    it("leaves an already-ordered document byte-for-byte intact", () => {
        const text = "alpha[^1] bravo[^2].\n\n[^1]: one\n[^2]: two";
        expect(reindexFootnotes(text)).toBe(text);
    });

    it("renumbers by first reference appearance", () => {
        const input = "bravo[^2] alpha[^1].\n\n[^1]: one\n[^2]: two";
        const expected = "bravo[^1] alpha[^2].\n\n[^1]: two\n[^2]: one";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("survives the swap collision ([^1] and [^2] trade places)", () => {
        // a naive sequential replace would merge both into one number
        const input = "x[^2] y[^1].\n\n[^1]: was one\n[^2]: was two";
        const expected = "x[^1] y[^2].\n\n[^1]: was two\n[^2]: was one";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("closes gaps in the numbering", () => {
        const input = "a[^3] b[^7].\n\n[^3]: three\n[^7]: seven";
        const expected = "a[^1] b[^2].\n\n[^1]: three\n[^2]: seven";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("moves every reference of a repeated reference together", () => {
        const input = "a[^5] b[^2] c[^5].\n\n[^2]: two\n[^5]: five";
        const expected = "a[^1] b[^2] c[^1].\n\n[^1]: five\n[^2]: two";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("handles multi-digit numbers", () => {
        const input = "a[^10] b[^2].\n\n[^2]: two\n[^10]: ten";
        const expected = "a[^1] b[^2].\n\n[^1]: ten\n[^2]: two";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("preserves named footnotes as-is", () => {
        const text = "alpha[^note] bravo[^why].\n\n[^note]: n\n[^why]: w";
        expect(reindexFootnotes(text)).toBe(text);
    });

    it("named footnotes do not consume a number", () => {
        const input = "a[^note] b[^5].\n\n[^5]: five\n[^note]: n";
        // [^5] is the FIRST numbered footnote → becomes [^1]; the named
        // definition still sorts by appearance (note before 5)
        const expected = "a[^note] b[^1].\n\n[^note]: n\n[^1]: five";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("slots named definitions into the appearance ordering", () => {
        const input =
            "one[^b] two[^2] three[^a].\n\n[^a]: A\n[^2]: II\n[^b]: B";
        const expected =
            "one[^b] two[^1] three[^a].\n\n[^b]: B\n[^1]: II\n[^a]: A";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("renumbers a reference that has no definition", () => {
        const input = "a[^5] b[^2].\n\n[^2]: two";
        const expected = "a[^1] b[^2].\n\n[^2]: two";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("keeps orphaned definitions, numbered after the referenced ones", () => {
        const input = "text[^3].\n\n[^3]: used\n[^9]: orphan";
        const expected = "text[^1].\n\n[^1]: used\n[^2]: orphan";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("keeps a named orphaned definition under its name", () => {
        const input = "text[^2].\n\n[^lost]: named orphan\n[^2]: used";
        const expected = "text[^1].\n\n[^1]: used\n[^lost]: named orphan";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("ignores references and definitions inside fenced code blocks", () => {
        const input = [
            "real[^2].",
            "",
            "```",
            "fake[^1] reference",
            "[^1]: fake definition",
            "```",
            "",
            "[^2]: def",
        ].join("\n");
        const expected = [
            "real[^1].",
            "",
            "```",
            "fake[^1] reference",
            "[^1]: fake definition",
            "```",
            "",
            "[^1]: def",
        ].join("\n");
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("respects ~~~ fences and longer closing fences", () => {
        const input = "a[^2].\n\n~~~\nfake[^1]\n~~~~\n\n[^2]: def";
        const expected = "a[^1].\n\n~~~\nfake[^1]\n~~~~\n\n[^1]: def";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("ignores references inside inline code", () => {
        const input = "use `[^1]` syntax[^2].\n\n[^2]: def";
        const expected = "use `[^1]` syntax[^1].\n\n[^1]: def";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("ignores references inside double-backtick code spans", () => {
        const input = "``code [^1] here`` real[^2].\n\n[^2]: def";
        const expected = "``code [^1] here`` real[^1].\n\n[^1]: def";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("does not treat an unclosed backtick as a code span", () => {
        const input = "a stray ` then a real[^2] reference.\n\n[^2]: def";
        const expected = "a stray ` then a real[^1] reference.\n\n[^1]: def";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("leaves frontmatter untouched", () => {
        const input = "---\ntitle: has [^1] inside\n---\nbody[^2].\n\n[^2]: def";
        const expected =
            "---\ntitle: has [^1] inside\n---\nbody[^1].\n\n[^1]: def";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("moves indented continuation lines with their definition", () => {
        const input = [
            "one[^2] two[^1].",
            "",
            "[^1]: first",
            "    first continued",
            "[^2]: second",
        ].join("\n");
        const expected = [
            "one[^1] two[^2].",
            "",
            "[^1]: second",
            "[^2]: first",
            "    first continued",
        ].join("\n");
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("moves multi-paragraph continuations (blank line + indent) too", () => {
        const input = [
            "one[^2] two[^1].",
            "",
            "[^1]: first paragraph",
            "",
            "    second paragraph of the same footnote",
            "[^2]: other",
        ].join("\n");
        const expected = [
            "one[^1] two[^2].",
            "",
            "[^1]: other",
            "[^2]: first paragraph",
            "",
            "    second paragraph of the same footnote",
        ].join("\n");
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("rewrites references inside definition content", () => {
        const input = "a[^2].\n\n[^2]: see also[^1]\n\n[^1]: the other";
        const expected = "a[^1].\n\n[^1]: see also[^2]\n\n[^2]: the other";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("keeps surrounding structure (headings, blank lines) in place", () => {
        const input = [
            "body[^2] text[^1].",
            "",
            "# Footnotes",
            "",
            "[^1]: one",
            "[^2]: two",
            "",
            "trailing line",
        ].join("\n");
        const expected = [
            "body[^1] text[^2].",
            "",
            "# Footnotes",
            "",
            "[^1]: two",
            "[^2]: one",
            "",
            "trailing line",
        ].join("\n");
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("is idempotent", () => {
        const messy = [
            "---",
            "title: t",
            "---",
            "start[^9] then[^note] and[^3] again[^9].",
            "",
            "`[^1]` in code.",
            "",
            "```",
            "[^4]: fenced",
            "```",
            "",
            "[^3]: three",
            "    continued",
            "[^note]: named",
            "[^9]: nine",
            "[^8]: orphan",
        ].join("\n");
        const once = reindexFootnotes(messy);
        expect(reindexFootnotes(once)).toBe(once);
    });
});

// Reindex never deletes an orphaned definition: the orphan rule does, and
// these run it first, as the lint does. Reindex's own deletion skipped the
// orphan rule's check on how the lines around a cut read, and was removed
// with its keepOrphanedDefinitions option (hunt 2026-10-05 round 2,
// cluster L7).
describe("reindexFootnotes after the orphan rule", () => {
    const reindexAfterOrphanRule = (input: string) => reindexFootnotes(removeOrphanedFootnoteDefinitions(input));

    it("deletes a numbered orphaned definition", () => {
        const input = "text[^3].\n\n[^3]: used\n[^9]: orphan";
        const expected = "text[^1].\n\n[^1]: used";
        expect(reindexAfterOrphanRule(input)).toBe(expected);
    });

    it("deletes a named orphaned definition", () => {
        const input = "text[^2].\n\n[^lost]: named orphan\n[^2]: used";
        const expected = "text[^1].\n\n[^1]: used";
        expect(reindexAfterOrphanRule(input)).toBe(expected);
    });

    it("deletes an orphan's continuation lines with it", () => {
        const input = [
            "text[^1].",
            "",
            "[^1]: used",
            "[^9]: orphan",
            "    orphan continued",
            "",
            "    orphan paragraph two",
        ].join("\n");
        const expected = "text[^1].\n\n[^1]: used";
        expect(reindexAfterOrphanRule(input)).toBe(expected);
    });

    it("collapses the blank gap a mid-document orphan leaves behind", () => {
        const input = "para one[^1].\n\n[^9]: orphan\n\npara two.\n\n[^1]: def";
        const expected = "para one[^1].\n\npara two.\n\n[^1]: def";
        expect(reindexAfterOrphanRule(input)).toBe(expected);
    });

    it("orphans never consume a number", () => {
        const input = "a[^7] b[^5].\n\n[^9]: orphan\n[^5]: five\n[^7]: seven";
        const expected = "a[^1] b[^2].\n\n[^1]: seven\n[^2]: five";
        expect(reindexAfterOrphanRule(input)).toBe(expected);
    });

    it("reindex on its own keeps orphans, numbered after the rest", () => {
        const input = "text[^3].\n\n[^3]: used\n[^9]: orphan";
        const expected = "text[^1].\n\n[^1]: used\n[^2]: orphan";
        expect(reindexFootnotes(input)).toBe(expected);
    });
});

describe("reindexFootnotes with renumberNamedFootnotes: true", () => {
    const renumberNamed = { renumberNamedFootnotes: true };

    it("converts named references to numbers by appearance order", () => {
        const input = "a[^note] b[^5].\n\n[^5]: five\n[^note]: n";
        const expected = "a[^1] b[^2].\n\n[^1]: n\n[^2]: five";
        expect(reindexFootnotes(input, renumberNamed)).toBe(expected);
    });

    it("moves every reference of a repeated named reference together", () => {
        const input = "a[^x] b[^2] c[^x].\n\n[^2]: two\n[^x]: ex";
        const expected = "a[^1] b[^2] c[^1].\n\n[^1]: ex\n[^2]: two";
        expect(reindexFootnotes(input, renumberNamed)).toBe(expected);
    });

    it("a kept named orphan gets the last number", () => {
        const input = "text[^2].\n\n[^lost]: named orphan\n[^2]: used";
        const expected = "text[^1].\n\n[^1]: used\n[^2]: named orphan";
        expect(reindexFootnotes(input, renumberNamed)).toBe(expected);
    });

    it("composes with orphan deletion", () => {
        const input = "text[^b] more[^2].\n\n[^lost]: orphan\n[^2]: two\n[^b]: bee";
        const expected = "text[^1] more[^2].\n\n[^1]: bee\n[^2]: two";
        expect(
            reindexFootnotes(removeOrphanedFootnoteDefinitions(input), {
                renumberNamedFootnotes: true,
            }),
        ).toBe(expected);
    });

    it("is idempotent", () => {
        const messy = "b[^note] a[^9] c[^note].\n\n[^9]: nine\n[^note]: n\n[^lost]: orphan";
        const once = reindexFootnotes(messy, renumberNamed);
        expect(reindexFootnotes(once, renumberNamed)).toBe(once);
    });
});

describe("reindexFootnotes and single-line HTML comments", () => {
    // found live 2026-07-17: a one-line <!-- [^66]: ... --> was renumbered
    // and its colon swapped - only MULTI-line comments were protected
    it("ignores references inside a single-line HTML comment", () => {
        const input = "text[^5]\n<!-- [^2]: commented out -->\n\n[^5]: five";
        const expected =
            "text[^1]\n<!-- [^2]: commented out -->\n\n[^1]: five";
        expect(reindexFootnotes(input)).toBe(expected);
    });

    it("ignores a comment span in the middle of a prose line", () => {
        const input = "a[^7] <!-- fake[^1] --> b[^7]\n\n[^7]: seven";
        const expected = "a[^1] <!-- fake[^1] --> b[^1]\n\n[^1]: seven";
        expect(reindexFootnotes(input)).toBe(expected);
    });
});
