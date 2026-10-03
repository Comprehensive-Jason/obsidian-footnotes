import { describe, expect, it } from "vitest";

import { inItemDefinitionLabels } from "../helpers/in-item";
import { findDefinitionBlocks } from "../../src/parsing/markdown-scan";

// BUG (wrong output): the reader for list-item definitions misses two
// definitions that sit inside a list item, so the lint moves them out of
// the item.
//
// What the user would see: a list item holds a closed code fence, and
// directly under the fence's closing line, at the item's margin, sits
// "  [^x]: def". That definition belongs to the list item. The plugin
// reads it as a definition at the top level of the note instead, so the
// lint moves it to the bottom, against Jason's ruling that list-item
// definitions are never moved. The same happens when an unindented lazy
// line ("lazy" under "- item") keeps the item open and a definition
// follows after a blank line.
//
// Needs a Reading-view check for the lazy-line face only: the fence face
// follows from CommonMark directly.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X13.
//
// Source of truth: Jason's ruling 1 of 2026-09-20 (list-item definitions
// stay where they are, never moved) and CommonMark 5.2 (a line indented to
// the item's content column belongs to the item; a lazy continuation line
// keeps the item's paragraph, and so the item, open).
//
// Cause: inItemDefinitionLabels works out the open list item on its own,
// and its model disagrees with the scanner's list model on these two
// shapes.

// Fixed by the runtime swap (2026-10-03): the note reading finds both
// definitions inside their item. Since Jason's ruling 1, option a, a
// definition in an item counts as a label line like any other, so the
// second half of each pin now asks what it meant: that the definition is
// not a top-level block the lint would move.

// What the plugin reads in `doc`: the list-item definitions and the top-level blocks that move.
function facts(doc: string) {
    const lines = doc.split("\n");
    return { inItem: inItemDefinitionLabels(lines), blocks: findDefinitionBlocks(lines) };
}

describe("in-item labels the reader misses", () => {
    it("a label directly under a fence closed inside the item is an in-item definition, not a document-level block", () => {
        const f = facts("- item\n\n  ```\n  code\n  ```\n  [^x]: def\n\nuse[^x]");
        expect(f.inItem.map((h) => h.line)).toEqual([5]);
        expect(f.blocks).toEqual([]);
    });

    it("a column-0 lazy line keeps the item open, so a margin label after the blank is in the item", () => {
        const f = facts("- item\nlazy\n\n  [^x]: def\n\nuse[^x]");
        expect(f.inItem.map((h) => h.line)).toEqual([3]);
        expect(f.blocks).toEqual([]);
    });
});
