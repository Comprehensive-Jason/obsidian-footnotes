// Imported from the opus-cycle-1 hunt of 2026-09-21 (OpenCode worktree); all pins flipped green 2026-09-21 after the fix.
// RESOLVED 2026-09-21 (probed in Reading view: a label at the item's own margin after a blank line renders as a definition, under a dash and under an ordered marker). The in-item reader's floor is the innermost item's content column, and the label pass and the lazy-label reader step over such lines, so nothing moves or renames them.
// Opus hunt cycle 1 of 2026-09-20 (worktree opus-cycle-1). 4 of 6 tests
// carry it.fails; the two controls do not.
import { describe, expect, it } from "vitest";

import { lintFootnotes, type LintOptions } from "../../src/linting/linter";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { inItemDefinitionNamesFolded } from "../helpers/in-item";

// Jason's ruling 1 of 2026-09-20 names two spellings of a footnote
// definition written inside a list item: "right after the marker
// (- [^la]: text) or indented to the item's margin under - item". Such a
// definition "is never moved".
//
// The item's margin under "- item" is column TWO - the marker plus its
// one-space gap - and under "1. item" it is column three. The reader that
// implements the ruling (src/parsing/list-item-definitions.ts) computes
// each open item's content column and then throws it away: the second
// branch tests `width < 4` against the document margin instead, so it only
// ever sees labels indented four columns or more. Under "- item" that is
// the item's margin PLUS two.
//
// A label at the item's own margin therefore falls through to the
// document-margin readers, which accept up to three spaces of indent and
// call it an ordinary column-0 definition. move-to-bottom then lifts it
// straight out of the list:
//
//     - item                          - item
//
//       [^la]: in item        ->      prose[^la]
//
//     prose[^la]                        [^la]: in item
//
// What the user sees: they lint a note and a definition they deliberately
// wrote inside a list item is cut out of that item and parked at the
// bottom, still carrying its two-space indent. The identical note written
// with four spaces is left alone, so the lint's behaviour flips on two
// characters of whitespace that change nothing about how Obsidian reads
// the note.
//
// Source of truth: Jason's rulings note of 2026-09-20, ruling 1 ("indented
// to the item's margin under - item ... is never moved"), and CommonMark
// 5.2 (a list item's content column is the marker's width plus its gap, so
// "  [^la]: x" under "- item" is that item's content).
//
// Settings involved: `Move definitions to the bottom` on for the move; the
// reader's blindness itself is settings-free and also reaches the rename
// command and reindex, which are meant to refuse and to leave the name
// alone.

const DASH = "- item\n\n  [^la]: in item\n\nprose[^la] here";
const ORDERED = "1. item\n\n   [^la]: in item\n\nprose[^la] here";
const FOUR = "- item\n\n    [^la]: in item\n\nprose[^la] here";

const inItemNames = (doc: string): Set<string> => inItemDefinitionNamesFolded(doc.split("\n"));

const options: LintOptions = {
    fixPunctuation: true,
    fixLazyDefinitions: true,
    moveDefinitionsToBottom: true,
    reindex: true,
};

describe("a definition indented to a list item's own margin", () => {
    it("is read as a definition inside the item, under a dash marker", () => {
        expect([...inItemNames(DASH)]).toEqual(["la"]);
    });

    it("is read as a definition inside the item, under an ordered marker", () => {
        expect([...inItemNames(ORDERED)]).toEqual(["la"]);
    });

    it("move-to-bottom leaves it inside the item", () => {
        expect(moveFootnoteDefinitionsToBottom(DASH)).toBe(DASH);
    });

    it("a whole lint leaves it inside the item", () => {
        expect(lintFootnotes(DASH, options)).toBe(DASH);
    });

    it("control: four spaces under the same item IS seen and left alone", () => {
        expect([...inItemNames(FOUR)]).toEqual(["la"]);
        expect(moveFootnoteDefinitionsToBottom(FOUR)).toBe(FOUR);
        expect(lintFootnotes(FOUR, options)).toBe(FOUR);
    });

    it("control: the label on the marker line is seen and left alone", () => {
        const doc = "- [^la]: in item\n\nprose[^la] here";
        expect([...inItemNames(doc)]).toEqual(["la"]);
        expect(lintFootnotes(doc, options)).toBe(doc);
    });
});
