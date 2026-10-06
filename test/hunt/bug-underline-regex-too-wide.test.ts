import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { lazyDefinitionLabelLines, underlinedDefinitionLabelLines } from "../../src/parsing/label-shapes";
import { readNote } from "../../src/parsing/note-reading";

// BUG (data loss): a lazy label over an indented or space-trailed "---" or
// "===" is taken for a heading's text, and Delete footnote everywhere cuts
// the line under it.
//
// What the user would see: a note reads "Text[^1] here", then "[^1]: def"
// on the very next line (a lazy label: with no blank line above it, the
// label is the paragraph's text, not a definition), then "  ---" (a
// horizontal rule written two spaces in) or "=== " (a line of text). Fix
// lazy definitions does nothing, the lint alert says Obsidian reads the
// label as a heading, and Delete footnote everywhere on [^1] deletes the
// label and the rule or text line under it as well. Obsidian draws no
// heading there: "  ---" and "--- " are horizontal rules of their own,
// "   ===" and "=== " plain text. The same happens inside a quote, where
// Delete footnote everywhere cuts a ">    ===" line under a lazy label.
//
// A "setext underline" is a line of "=" or "-" under a one-line paragraph,
// which turns that paragraph into a heading.
//
// Hunt 2026-10-06, cycle 3, lens reader. Clusters R1 and R2.
//
// Origin: R1 pre-existing (cec4352 gives the same); R2, the quoted face,
// regression (since cec4352, from 8242310, which reads the line under the
// label from where its containers end, so ">    ===" now counts as
// "   ===" in the same quote).
//
// Source of truth: live Obsidian 1.14.4, 2026-10-06: "Text[^1] here" / ""
// / "[^1]: def" / "  ---" (or "--- ") is a definition on line 2 only, with
// line 3 a thematic break; with "   ===" or "=== " the "===" is the
// definition's own text; with no blank line above the label, no definition
// and no heading. remark-parse 8's setext reader
// (lib/tokenize/heading-setext.js) takes an underline only as markers
// alone from column 0 of the container's text. The note reading agrees
// (the controls below).
//
// Cause: underlinedAt in src/parsing/label-shapes.ts tests the line under
// the label with /^ {0,3}(?:=+|-+) *$/, which allows up to three spaces in
// front and any number after.

const Shapes: { what: string; under: string; block: RegExp }[] = [
    { what: "an indented thematic break", under: "  ---", block: /^\^thematicBreak$/ },
    { what: "a thematic break with a trailing space", under: "--- ", block: /^\^thematicBreak$/ },
    { what: "an indented '==='", under: "   ===", block: /^paragraph$/ },
    { what: "a '===' with a trailing space", under: "=== ", block: /^paragraph$/ },
];

describe("an underline-shaped line that Obsidian reads as no underline", () => {
    for (const { what, under, block } of Shapes) {
        const lines = ["Text[^1] here", "[^1]: def", under, "", "More"];
        const fixed = ["Text[^1] here", "", "[^1]: def", under, "", "More"];

        it(`control (${what}): the reading reads the line on its own and a blank line above makes a definition`, () => {
            expect(readNote(lines).lineBlocks[2]).toMatch(block);
            expect(readNote(lines).lineBlocks[1]).toBe("paragraph");
            expect(readNote(fixed).labelOn(2)?.name).toBe("1");
        });

        it.fails(`${what}: the label is lazy, not underlined`, () => {
            expect(underlinedDefinitionLabelLines(lines)).toEqual([]);
            expect(lazyDefinitionLabelLines(lines)).toEqual([1]);
        });

        it.fails(`${what}: fix-lazy inserts the blank line`, () => {
            expect(fixLazyDefinitions(lines.join("\n"))).toBe(fixed.join("\n"));
        });

        it.fails(`${what}: Delete footnote everywhere keeps the line under the label`, () => {
            const plan = deleteFootnoteEverywhere(lines.join("\n"), "1") as { kind: string; markdown?: string };
            // A refusal would do too; cutting the line under the label would not.
            expect(plan.kind === "refused" || (plan.markdown ?? "").split("\n").includes(under)).toBe(true);
        });
    }

    // The face new since cec4352 (R2). At cec4352 the quote depths of the
    // two lines differed, the label counted as lazy, and the delete refused.
    it.fails("a lazy label in a quote over '>    ===': Delete footnote everywhere keeps the quoted line", () => {
        const lines = ["See[^1]", "", "> a", "[^1]: lazy", ">    ===", "", "More"];
        expect(readNote(lines).lineBlocks[4]).toBe("blockquote paragraph");
        const plan = deleteFootnoteEverywhere(lines.join("\n"), "1") as { kind: string; markdown?: string };
        expect(plan.kind === "refused" || (plan.markdown ?? "").includes(">    ===")).toBe(true);
    });
});
