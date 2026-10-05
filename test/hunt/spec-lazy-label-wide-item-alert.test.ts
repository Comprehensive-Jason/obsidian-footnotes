import { describe, expect, it } from "vitest";

import { lazyDefinitionLabelNames, orphanedFootnoteReferenceNames } from "../../src/linting/rules/remove-orphaned-references";

// spec question (UI text): which alert should speak for a lazy label in a
// list item whose text starts 4 columns in?
//
// What it does now: a lazy label is a "[^b]:" line directly under a line
// of prose, which Obsidian reads as more of that paragraph. In a nested
// item ("- parent", "  - child", "    [^b]: lazy in child") or a wide
// numbered item ("10. item", "    [^b]: lazy"), the lint's alert says
// [^b] has no definition and asks the user to write one, though they
// already did.
// What a user might expect: the lazy-definition alert, which says the
// label is read as plain text and how to fix it, as it does for the same
// label in an item whose text starts at column 2.
// Why it is a question and not a bug: the existing pin
// bug-in-item-lazy-label-counted-as-definition accepts either alert for
// a lazy label in a list item, and nothing in the note changes. Which
// alert should speak is Jason's call. The label itself going unfixed,
// and being cut by Delete orphaned references, is pinned as
// bug-lazy-label-wide-item-content-column.
//
// Hunt 2026-10-05, round 1, lens containers. Cluster CN3 (its alert).
//
// Source of truth: sheet 14 (a label directly under a line of prose is
// lazy); the column-2 case, where lazyDefinitionLabelNames names the
// label.

const NESTED = ["Use[^b] here.", "", "- parent", "  - child", "    [^b]: lazy in child"];
const WIDE = ["Use[^b] here.", "", "10. item", "    [^b]: lazy in a wide ordered item"];

describe("the alert for a lazy label at an item's content column of 4", () => {
    for (const [name, lines] of [["nested item", NESTED], ["wide ordered item", WIDE]] as const) {
        it.fails(`${name}: the lazy-definition alert names it, not the missing-definition alert`, () => {
            // Today: [], the lazy-definition alert does not name it.
            expect(lazyDefinitionLabelNames(lines)).toEqual(["b"]);
            expect(orphanedFootnoteReferenceNames(lines.join("\n"))).toEqual([]);
        });
    }
});
