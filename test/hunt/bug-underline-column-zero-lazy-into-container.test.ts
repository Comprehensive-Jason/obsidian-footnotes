import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { lazyDefinitionLabelLines } from "../../src/parsing/label-shapes";
import { readNote } from "../../src/parsing/note-reading";

// BUG (data loss): a column-0 lazy label under a quote or a list item,
// over an underline-shaped line inside that quote or item ("> ===",
// "  ---", "  ==="), is taken for a heading's text. Delete footnote
// everywhere cuts the line under it, and fix lazy definitions leaves it.
//
// What the user would see: a quote reads "> Text[^1] here", then
// "[^1]: def" at the left margin on the very next line (a lazy label: it
// carries on the quote's paragraph, so it is no definition), then
// "> ===". The lint alert says Obsidian reads the label as a heading,
// fix lazy definitions does nothing, and Delete footnote everywhere on
// [^1] deletes the label and the "> ===" line with it. The same happens
// in a list item ("- Text[^1] here", "[^1]: def", "  ---"), where the
// item's horizontal rule is cut, and with "- item", "[^1]: def", "  ===",
// which fix lazy definitions leaves alone although a blank line above the
// label makes it a definition. Obsidian draws no heading in any of them.
//
// A "setext underline" is a line of "=" or "-" under a one-line paragraph,
// which turns that paragraph into a heading.
//
// Hunt 2026-10-06, cycle 4, lens labels. Cluster B2.
//
// Origin: pre-existing.
//
// Source of truth: live Obsidian 1.14.4, 2026-10-06: "> Text[^1] here" /
// "[^1]: def" / "> ===" / "" / "More" has no definition and one
// blockquote on lines 0 to 2 (no heading); "- Text[^1] here" / "[^1]: def"
// / "  ---" / "" / "More" has no definition and a list on lines 0 to 2.
// The note reading after the blank line fix-lazy would insert: the label
// is a top-level definition and the line under it stays in its quote or
// item (or, for "  ===", is the definition's own text). The expectation
// for Delete footnote everywhere copies the pin
// bug-underline-regex-too-wide's: a refusal would do, cutting the line
// under the label would not.
//
// Cause: underlinedAt in src/parsing/label-shapes.ts judges the line under
// the label inside the containers the label sits in now. A lazy label has
// no marker of its own for the quote or item it carries on, and a blank
// line above it ends that quote or item, so the label becomes a top-level
// definition and the line under it stays inside its container, no
// underline at all. The hunt proposes deciding "underlined" by reading
// the note with a blank line above the label, as fix-lazy does.

describe("bug: a column-0 lazy label over an underline-shaped line inside the container it carries on", () => {
    it("a quoted '> ===' under a column-0 lazy label in the quote: Delete footnote everywhere keeps the line under the label", () => {
        const lines = ["> Text[^1] here", "[^1]: def", "> ===", "", "More"];
        const plan = deleteFootnoteEverywhere(lines.join("\n"), "1") as { kind: string; markdown?: string };
        // Today the plan deletes, and its note reads "> Text here", "", "More".
        expect(plan.kind === "refused" || (plan.markdown ?? "").split("\n").includes("> ===")).toBe(true);
    });

    it("an item's horizontal rule '  ---' under a column-0 lazy label in the item: Delete footnote everywhere keeps the line under the label", () => {
        const lines = ["- Text[^1] here", "[^1]: def", "  ---", "", "More"];
        const plan = deleteFootnoteEverywhere(lines.join("\n"), "1") as { kind: string; markdown?: string };
        // Today the plan deletes, and its note reads "- Text here", "", "More".
        expect(plan.kind === "refused" || (plan.markdown ?? "").split("\n").includes("  ---")).toBe(true);
    });

    it("a quoted '> ===' under a column-0 lazy label: fix-lazy inserts the blank line", () => {
        const lines = ["> Text[^1] here", "[^1]: def", "> ===", "", "More"];
        // Today fix-lazy returns the note unchanged.
        expect(fixLazyDefinitions(lines.join("\n"))).toBe(["> Text[^1] here", "", "[^1]: def", "> ===", "", "More"].join("\n"));
    });

    it("'- item' / '[^1]: def' / '  ===' is filed lazy and fix-lazy fixes it", () => {
        const lines = ["- item", "[^1]: def", "  ==="];
        // Today the label is filed underlined, so the lazy list is empty.
        expect(lazyDefinitionLabelLines(lines)).toEqual([1]);
        const out = fixLazyDefinitions(lines.join("\n"));
        expect(readNote(out.split("\n")).definitions.length).toBe(1);
    });
});
