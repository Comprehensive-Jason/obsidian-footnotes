import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): with Merge duplicate definitions on, the merge writes
// a later copy's text straight under a first copy that ends in a quote, a
// callout, or a list, so the text joins that quote or list.
//
// What the user would see: "[^a]: Smith, p. 4:", a blank line, the quote
// "    > The tide rose.", a blank line, and a second definition
// "[^a]: See also Jones.". Ctrl+S merges the two into "[^a]: Smith, p. 4:",
// "", "    > The tide rose.", "    See also Jones.". Reading view now draws
// "See also Jones." inside the quote box, as if Smith wrote it. With a
// list of pages ("    - p. 4", "    - p. 9") it is drawn inside the "p. 9"
// bullet, and with a callout inside the callout.
//
// A "lazy" line is one that carries on the paragraph above it without the
// marker or indentation it would normally need; a line straight under a
// quote's or a list item's paragraph is read as more of it.
//
// Hunt 2026-10-08, cycle 6. Cluster Z20.
//
// Origin: pre-existing.
//
// Source of truth: live Obsidian 1.14.4 on sprout (2026-10-08, Reading
// view): c6:z20-quote draws "See also Jones." inside the quote, and
// c6:z20-list inside the "p. 9" bullet. The merge rule's contract in
// src/linting/rules/merge-duplicate-definitions.ts ("The merged block
// therefore renders every body, in the order they appeared in the note"),
// and its X34 fix, which already adds a blank line first when the copy
// above ends in a held definition, so the merged text is "a paragraph of
// the first copy's own". docs/obsidian-reading-rules.md B4 for list items.
//
// Cause: mergeDuplicateFootnoteDefinitions adds that blank line only when
// the copy above ends in a definition held inside it, not when it ends in
// a quote, a callout, or a list. The result gate does not catch it either:
// its merge check (mergedShapeVerdict in src/editor/result-gate.ts) counts
// only the blocks that start inside the merged footnote, other than
// paragraphs, and a lazy line starts no block; check 1 skips the merged
// footnote's own lines.

/** The blocks of the line holding exactly `text` (lineBlocks: the blocks the line belongs to, a "^" marking where one starts). */
function blocksOf(markdown: string, text: string): string {
    const lines = markdown.split("\n");
    const at = lines.findIndex((line) => line.trim() === text);
    if (at < 0) return "<line gone>";
    return readNote(lines).lineBlocks[at] ?? "";
}

const Cases = [
    { what: "a quote", doc: "Smith says so.[^a]\n\n[^a]: Smith, p. 4:\n\n    > The tide rose.\n\n[^a]: See also Jones.\n" },
    { what: "a callout", doc: "Smith says so.[^a]\n\n[^a]: Smith, p. 4:\n\n    > [!quote]\n    > The tide rose.\n\n[^a]: See also Jones.\n" },
    { what: "a list", doc: "Smith says so.[^a]\n\n[^a]: Smith, pages:\n\n    - p. 4\n    - p. 9\n\n[^a]: See also Jones.\n" },
];

describe("merging a later copy under a first copy that ends in a quote or a list", () => {
    for (const { what, doc } of Cases) {
        it(`control (${what}): before the merge, the later copy's text is a paragraph of its own footnote, in no quote or list`, () => {
            expect(blocksOf(doc, "[^a]: See also Jones.")).toBe("^footnoteDefinition ^paragraph");
        });

        // Now: "    See also Jones." straight under the quote's or the list's
        // last line, read as part of it.
        it(`${what}: the merged text stays out of the quote or list (a paragraph of its own in the footnote)`, () => {
            const merged = mergeDuplicateFootnoteDefinitions(doc);
            const blocks = blocksOf(merged, "See also Jones.");
            expect(blocks, JSON.stringify(merged)).not.toMatch(/blockquote|listItem/);
        });

        it(`${what}: the lint with Merge duplicate definitions on does the same`, () => {
            const out = lintFootnotes(doc, { mergeDuplicateDefinitions: true });
            expect(blocksOf(out, "See also Jones."), JSON.stringify(out)).not.toMatch(/blockquote|listItem/);
        });
    }
});
