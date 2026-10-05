import { describe, expect, it } from "vitest";

import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// BUG (data loss with Delete orphaned references on; annoyance with the
// default settings): a lazy label inside a list item whose text starts 4
// columns in is not recognised, so the lint cannot fix it and the
// orphan rule cuts it apart.
//
// What the user would see: a lazy label is a "[^b]:" line directly under
// a line of prose; Obsidian reads it as more of that paragraph, so it
// defines nothing. Inside a nested item ("- parent", "  - child", then
// "    [^b]: lazy in child") or a wide numbered item ("10. item", then
// "    [^b]: lazy"), the item's text starts at column 4. Fix lazy
// definitions does nothing there, so [^b] stays undefined. With Delete
// orphaned references turned on, the lint deletes the "[^b]" in the text
// AND the "[^b]" at the head of the label, leaving ": lazy in child".
// The same label in an item whose text starts at column 2 ("- item",
// then "  [^b]: x") is fixed and kept.
//
// Hunt 2026-10-05, round 1, lens containers. Cluster CN3.
//
// Source of truth: sheet 14 (a label directly under a line of prose is
// lazy); the column-2 control in the hunt probe, where the lazy alert
// names the label, Fix lazy definitions makes it an in-item definition,
// and the orphan rule leaves it alone.
//
// Cause: the label-shape reader in label-shapes.ts (DefinitionStart,
// /^ {0,3}\[\^/) measures from the note's margin, so a label at column 4
// is no label to it. The item's own content column is not taken into
// account.
//
// The lazy-definition alert's side of this is pinned on its own
// (spec-lazy-label-wide-item-alert).

const NESTED = ["Use[^b] here.", "", "- parent", "  - child", "    [^b]: lazy in child"];
const WIDE = ["Use[^b] here.", "", "10. item", "    [^b]: lazy in a wide ordered item"];

describe("a lazy label at an item's content column of 4", () => {
    it.fails("nested item: fix-lazy turns it into a definition inside its item", () => {
        const out = fixLazyDefinitions(NESTED.join("\n"));
        // Today: [], nothing is fixed.
        expect(readNote(out.split("\n")).definitions.map((d) => d.name)).toEqual(["b"]);
    });

    for (const [name, lines] of [["nested item", NESTED], ["wide ordered item", WIDE]] as const) {
        it.fails(`${name}: Delete orphaned references leaves the label and its reference alone`, () => {
            // Today: "Use here." and ": lazy ...", both "[^b]" gone.
            expect(removeOrphanedFootnoteReferences(lines.join("\n"))).toBe(lines.join("\n"));
        });
    }
});
