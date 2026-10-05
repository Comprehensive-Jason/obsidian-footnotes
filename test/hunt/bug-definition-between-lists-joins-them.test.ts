import { describe, expect, it } from "vitest";

import { parseObsidianNote, MarkdownNode } from "../../src/parsing/obsidian-markdown";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (wrong output): when a definition sits between two lists, moving it
// to the bottom joins the two lists into one.
//
// What the user would see: their note has a numbered list, then a
// footnote definition, then a second numbered list that starts again at
// 1. The default lint moves the definition to the bottom of the note.
// With only blank lines left between them, the two lists become one: the
// second list now continues the first one's numbering (2 instead of 1),
// and two tight bullet lists turn into one loose list, with more space
// between the items.
//
// Hunt 2026-10-05, round 1, lens containers. Cluster CN2.
//
// Source of truth: remark-parse 8, the parser Obsidian uses, joins two
// lists that only blank lines separate (the plugin's reader, which uses
// it, shows this). How Reading view draws the joined list is still to be
// confirmed live. Orphan deletion, delete everywhere, normal to inline,
// and merging a duplicate show the same join; this pin keeps the
// default-lint faces.
//
// Cause: the guards that stop a rewrite from changing how the lines
// around it are read (linesReadDifferently, linesReadAlike) compare
// lineBlocks, the list of blocks each line belongs to, and a list there
// carries no mark of where it starts, so two lists and one list look the
// same.

/** The lists at the top level of the note, each as [ordered, start, items, loose]. */
function lists(md: string): [boolean, number | null, number, boolean][] {
    const { tree } = parseObsidianNote(md);
    return (tree.children ?? [])
        .filter((node: MarkdownNode) => node.type === "list")
        .map((node: MarkdownNode) => {
            const n = node as MarkdownNode & { ordered?: boolean; start?: number | null; spread?: boolean; loose?: boolean };
            const loose = (node.children ?? []).some((item) => (item as { spread?: boolean }).spread === true) || n.spread === true || n.loose === true;
            return [n.ordered === true, n.start ?? null, (node.children ?? []).length, loose];
        });
}

const ORDERED = ["Intro[^b] text.", "", "1. first list", "", "[^b]: between the lists", "", "1. second list", "", "More prose."];
const TIGHT = ["Intro[^b] text.", "", "- a", "- b", "", "[^b]: between the lists", "", "- c", "- d", "", "More prose."];

describe("a definition between two lists", () => {
    it.fails("move to bottom keeps the two ordered lists apart", () => {
        const out = moveFootnoteDefinitionsToBottom(ORDERED.join("\n"));
        expect(out).not.toBe(ORDERED.join("\n"));
        // Today: 1, the lists are joined.
        expect(lists(out).length).toBe(2);
    });

    it.fails("move to bottom keeps the two tight bullet lists apart (and tight)", () => {
        const out = moveFootnoteDefinitionsToBottom(TIGHT.join("\n"));
        // Today: [[false, null, 4, true]], one loose list of four items.
        expect(lists(out)).toEqual(lists(TIGHT.join("\n")));
    });

    it.fails("the default lint keeps them apart", () => {
        const out = lintFootnotes(ORDERED.join("\n"), { sectionHeading: "" });
        expect(lists(out).length).toBe(2);
    });
});
