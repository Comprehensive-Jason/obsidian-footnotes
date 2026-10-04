// Imported from the opus-cycle-1 hunt of 2026-09-21 (OpenCode worktree); all pins flipped green 2026-09-21 after the fix.
// RESOLVED 2026-09-21 (probed in Reading view: a label directly under an item's prose renders as plain text, one after a blank line or an empty item as a definition). The in-item reader now needs a boundary above the label.
// Opus hunt cycle 1 of 2026-09-20 (worktree opus-cycle-1). 4 of 6 tests
// carry it.fails; the two controls do not.
import { describe, expect, it } from "vitest";

import {
    lazyDefinitionLabelNames,
    orphanedFootnoteReferenceNames,
} from "../../src/linting/rules/remove-orphaned-references";
import { inItemDefinitionLabels } from "../helpers/in-item";

// A label written inside a list item DIRECTLY UNDER a line of prose:
//
//     - item text
//         [^lc]: straight under the marker line
//
//     use[^lc] here
//
// The plugin's recorded prose-label rule (sheet 14, and the shared
// generator's own "- item[^91]" / "  [^91]: lazy under a list item" case)
// says a label directly under a line of prose - paragraph text, a list
// item, a quote line - is LAZY: Obsidian folds it into the paragraph above
// and renders the characters "[^lc]: ..." as plain text. Every margin
// reader implements that, which is why the column-0 twin ("para" then
// "[^ld]: lazy") is named by the lazy-definition alert.
//
// inItemDefinitionLabels has no laziness rule at all. Its second branch
// asks only three things of a line: an item is open, the margin readers did
// not already claim it (`starts[i]`), and it is indented four columns or
// more. A label under the item's own prose passes all three, so the reader
// reports it as a real in-item definition - and so does a label under a
// QUOTED prose line inside the item, which the recorded rule (cycle 8, "a
// quoted label directly under a quoted paragraph line is lazy prose") also
// calls lazy.
//
// What the user sees: NOTHING, which is the problem. Ruling 1 of
// 2026-09-20 wired the in-item reader into the orphan-reference alert, so
// "[^lc]" in the body now counts as defined and the orphan alert stays
// quiet; the lazy-definition alert is a margin reader and never looked
// inside the item, so it stays quiet too. The note renders with a footnote
// reference pointing at nothing and a line of literal "[^lc]: ..." text in
// the list, and the lint tells the user neither - exactly the silent miss
// the never-silent policy forbids (ADR 0002). The hotkey inherits it:
// pressed on "[^lc]", it navigates to the fake definition (or opens the
// popup on it) instead of writing a real one.
//
// Source of truth: the prose-label rule as sheet 14 records it and as the
// column-0 control below shows it working, the cycle-8 ruling for the
// quoted spelling, and ADR 0002 (never silent).
//
// Settings involved: none for the reader; `Delete orphaned references` and
// the lint alerts inherit the answer, and `Fix definitions hidden by a
// missing blank line` cannot reach the label either.

const LAZY_ITEM = "- item text\n    [^lc]: straight under the marker line\n\nuse[^lc] here";
const LAZY_QUOTED_ITEM = "- item\n\n    > quote line\n    > [^lb]: under quoted prose\n\nuse[^lb] here";
const REAL_ITEM = "- item\n\n    [^la]: a real in-item definition\n\nuse[^la] here";
const MARGIN_TWIN = "para\n[^ld]: lazy at the margin\n\nuse[^ld] here";

const readersOf = (doc: string) => {
    const lines = doc.split("\n");
    return {
        inItem: inItemDefinitionLabels(lines),
        lazy: lazyDefinitionLabelNames(lines),
        orphans: orphanedFootnoteReferenceNames(doc),
    };
};

describe("a label inside a list item, directly under prose", () => {
    it("is not read as a definition inside the item", () => {
        expect(readersOf(LAZY_ITEM).inItem).toEqual([]);
    });

    it("leaves the reference in the body alerted, by one alert or the other", () => {
        const { lazy, orphans } = readersOf(LAZY_ITEM);
        expect([...lazy, ...orphans]).toContain("lc");
    });

    it("the quoted spelling is not read as a definition either", () => {
        expect(readersOf(LAZY_QUOTED_ITEM).inItem).toEqual([]);
    });

    it("the quoted spelling's reference is alerted too", () => {
        const { lazy, orphans } = readersOf(LAZY_QUOTED_ITEM);
        expect([...lazy, ...orphans]).toContain("lb");
    });

    it("control: under a blank line the in-item definition is real and nothing is alerted", () => {
        const { inItem, lazy, orphans } = readersOf(REAL_ITEM);
        expect(inItem.map((hit) => hit.name)).toEqual(["la"]);
        expect(lazy).toEqual([]);
        expect(orphans).toEqual([]);
    });

    it("control: the column-0 twin is named by the lazy-definition alert", () => {
        const { inItem, lazy } = readersOf(MARGIN_TWIN);
        expect(inItem).toEqual([]);
        expect(lazy).toEqual(["ld"]);
    });
});
