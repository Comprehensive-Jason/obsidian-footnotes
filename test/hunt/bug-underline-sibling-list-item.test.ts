import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { labelShapedLines } from "../../src/parsing/label-shapes";

// BUG (data loss): a second list item "- ===" (or "- ==") under a lazy
// label in the first item is taken for the label's underline, and Delete
// footnote everywhere cuts that whole item.
//
// What the user would see: a list reads "- Text[^1] here", then
// "[^1]: def" on the very next line (a lazy label: with no blank line
// above it, the label is more of the item's text, not a definition), then
// a second item "- ===". The lint alert says Obsidian reads the label as a
// heading, fix lazy definitions does nothing, and Delete footnote
// everywhere on [^1] deletes the label and the whole second item with it.
// Obsidian draws no heading there: "- ===" is an item of its own. The
// same happens with "  [^1]: def" at the first item's content column
// over "- ==".
//
// A "setext underline" is a line of "=" or "-" under a one-line paragraph,
// which turns that paragraph into a heading.
//
// Hunt 2026-10-06, cycle 4, lens labels. Cluster B1.
//
// Origin: pre-existing.
//
// Source of truth: live Obsidian 1.14.4, 2026-10-06: "- Text[^1] here" /
// "[^1]: def" / "- ===" / "" / "More" has no definition and one list on
// lines 0 to 2 (no heading); CommonMark ("- ===" starts a list item). The
// note reading agrees: with a blank line above the label, the label is a
// definition and "- ===" no heading. The expectation for Delete footnote
// everywhere copies the pin bug-underline-regex-too-wide's: a refusal
// would do, cutting the line under the label would not.
//
// Cause: underlinedAt in src/parsing/label-shapes.ts compares the two
// lines' containers through containersOf, which strips the "^" marks
// where blocks start. The second item's "list ^listItem" then reads the
// same as the first item's "list listItem", so a NEW item counts as the
// label's own container, and its "===" as the label's underline.

const Shapes: { what: string; lines: string[]; under: string }[] = [
    { what: "a second list item '- ===' under a lazy label in the first", lines: ["- Text[^1] here", "[^1]: def", "- ===", "", "More"], under: "- ===" },
    { what: "a second list item '- ==' under a label at the first item's content column", lines: ["- Text[^1] here", "  [^1]: def", "- ==", "", "More"], under: "- ==" },
];

describe("bug: a sibling list item under a lazy label is taken for its underline", () => {
    for (const { what, lines, under } of Shapes) {
        it(`${what}: the label is lazy, not underlined`, () => {
            expect(labelShapedLines(lines)).toEqual([{ line: 1, name: "1", underlined: false }]);
        });

        it(`${what}: Delete footnote everywhere keeps the line under the label`, () => {
            const plan = deleteFootnoteEverywhere(lines.join("\n"), "1") as { kind: string; markdown?: string };
            // Today the plan deletes, and its note reads "- Text here", "", "More".
            expect(plan.kind === "refused" || (plan.markdown ?? "").split("\n").includes(under)).toBe(true);
        });
    }
});
