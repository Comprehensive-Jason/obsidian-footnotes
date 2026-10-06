import { describe, expect, it } from "vitest";

import { lazyDefinitionLabelLines, underlinedDefinitionLabelLines } from "../../src/parsing/label-shapes";
import { readNote } from "../../src/parsing/note-reading";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";

// BUG (annoyance): a lazy label in a list item above a "---" that ends the item is filed as
// underlined, and a quoted label over a lazy "===" is filed as lazy.
//
// What the user would see: in "- a" / "  [^1]: x" / "---", the label line is ordinary text of
// the list item and the "---" is a separate horizontal rule, so a blank line above the label
// would make it a footnote definition. The plugin instead files the label as "underlined": Fix
// lazy definitions does nothing, and the alert says Obsidian reads it as a heading. The other
// way round, in "> q" / ">" / "> [^a]: body" / "===", Obsidian draws the label line as a heading
// (the "===" continues the quote lazily), but the plugin files it as lazy, so the alert tells
// the user to add a blank line above it, which changes nothing, and the alert whose advice
// would work stays silent.
//
// A "lazy" label is a "[^x]: ..." line that Obsidian reads as text of the paragraph above it,
// not as a definition. An "underlined" label is one with a setext underline ("===" or "---")
// right under it, which makes it a heading.
//
// Hunt 2026-10-05, round 2, lens reader. Cluster R1.
//
// Source of truth: Obsidian 1.14.4, 2026-10-05: "- a" / "  [^1]: x" / "---" has no definition
// and the "---" is a thematic break; "- a" / "" / "  [^1]: x" / "---" has a definition at line
// 2; "> q" / ">" / "> [^a]: body" / "===" has no definition; reproducer:c893-def-only-plugin-x1
// ("> [^ä]: body text" / "===": no definition, a live [^ä] at 0:2). The note reading agrees in
// each case (the controls below).
//
// Cause: underlineUnder in src/parsing/label-shapes.ts judges the line under the label from the
// margin. It compares the quote markers of the two lines and tests the rest for "===" or "---",
// without asking the reading whether that line ends the label's list item (a "---" at the
// margin closes it) or continues the quoted paragraph lazily (a "===" with no ">" in front).
// The wide-item faces of this root are cluster L6, pinned in
// bug-underlined-label-wide-item.test.ts.
//
// Fixed 2026-10-05: underlinedAt (it replaced underlineUnder) reads the line under the label from
// where its containers end, and counts it an underline only when the reading puts it in the same
// containers as the label's line.

const Cases: { what: string; lines: string[]; label: number; fixed: string[] }[] = [
    {
        what: "a list item, the break at the margin",
        lines: ["- a", "  [^1]: x", "---", "", "see[^1]"],
        label: 1,
        fixed: ["- a", "", "  [^1]: x", "---", "", "see[^1]"],
    },
    {
        what: "a nested list item, the break in the outer item",
        lines: ["- a", "  - b", "    [^1]: x", "  ---", "", "see[^1]"],
        label: 2,
        fixed: ["- a", "  - b", "", "    [^1]: x", "  ---", "", "see[^1]"],
    },
    {
        what: "a list item in a quote, the break in the quote",
        lines: ["> - a", ">   [^1]: x", "> ---", "", "see[^1]"],
        label: 1,
        fixed: ["> - a", ">", ">   [^1]: x", "> ---", "", "see[^1]"],
    },
];

describe("a thematic break under a lazy label in a list item is no underline", () => {
    it("control: under a top-level paragraph the '---' is what a blank line above would turn into the label's underline", () => {
        const lines = ["a", "[^1]: x", "---", "", "see[^1]"];
        expect(underlinedDefinitionLabelLines(lines)).toEqual([1]);
        expect(readNote(["a", "", "[^1]: x", "---"]).lineBlocks[2]).toBe("^heading2");
    });

    for (const c of Cases) {
        it(`control: ${c.what}: the reading says the '---' is a break of its own, and a blank line above the label makes a definition`, () => {
            expect(readNote(c.lines).lineBlocks[c.label + 1]).toMatch(/\^thematicBreak$/);
            expect(readNote(c.fixed).labelOn(c.label + 1)?.name).toBe("1");
        });

        it(`${c.what}: the label is lazy, not underlined`, () => {
            expect(underlinedDefinitionLabelLines(c.lines)).toEqual([]);
            expect(lazyDefinitionLabelLines(c.lines)).toEqual([c.label]);
        });

        // Before the fix fix-lazy returns the note unchanged.
        it(`${c.what}: fix-lazy inserts the blank line`, () => {
            expect(fixLazyDefinitions(c.lines.join("\n"))).toBe(c.fixed.join("\n"));
        });
    }
});

const Headings: { what: string; lines: string[]; label: number }[] = [
    { what: "Obsidian's answer: a quoted label over a lazy '==='", lines: ["> [^ä]: body text", "===", ""], label: 0 },
    { what: "a quoted label after a blank quote line, over a lazy '==='", lines: ["> q", ">", "> [^a]: body", "===", "", "see[^a]"], label: 2 },
];

describe("a quoted label the reading makes a heading is underlined, not lazy", () => {
    for (const c of Headings) {
        it(`control: ${c.what}: the reading makes the label line a heading`, () => {
            expect(readNote(c.lines).lineBlocks[c.label]).toMatch(/\^heading\d$/);
        });

        it(`${c.what}: it is filed as underlined, not lazy`, () => {
            expect(lazyDefinitionLabelLines(c.lines)).toEqual([]);
            expect(underlinedDefinitionLabelLines(c.lines)).toEqual([c.label]);
        });
    }
});
