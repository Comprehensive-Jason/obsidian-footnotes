import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { definitionsHoldingTheMoveBack, moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

// BUG (annoyance): the move to the bottom refuses an indented label that
// would join the list item ending the note, reindex then reorders the
// definitions so the move would work, and only the NEXT lint gathers them,
// with no alert in between.
//
// What the user would see: a note ending in "- item", with "  [^1]: one"
// (two spaces in front) and "[^a]: a" above it. Ctrl+S reorders the
// definitions but leaves them where they are, and says nothing. A second
// Ctrl+S with nothing edited moves them below the list. The lint memo
// (which remembers a note it just linted and answers "No linting needed."
// to the next save of the same text) can hold that second lint back until
// the user edits the note.
//
// "Idempotent" means that running the lint a second time changes nothing:
// lint(lint(note)) equals lint(note). "Reindex" is the lint rule that
// renumbers footnotes and puts their definitions in reference order.
//
// Hunt 2026-10-06, cycle 5, lens lint. Cluster X31.
//
// Origin: regression (bb3f729), in the idempotence sense. Before it the
// move went through on the first lint and put the label inside the list
// item (the bug that commit fixed); now it refuses, and the refusal shows
// this.
//
// Source of truth: the idempotence property of the lint pipeline
// (attack-surface.md, properties: f(f(doc)) === f(doc)); ADR 0002, the lint
// is never silent about what it leaves.
//
// Cause: lintFootnotes in src/linting/linter.ts runs the move before
// reindex. The move rightly refuses: gathered in the order written, the
// indented label would come first under the list item and join it.
// Reindex then swaps the definitions, which puts a column-0 label first,
// and under it the indented one reads as a definition of its own; but the
// move has already run. The move alert reads the note after reindex, where
// gathering works, so it names nothing.

describe("the move refuses an indented label, reindex reorders, the next lint gathers", () => {
    // [^a] is cited and [^1] is not, so reindex puts [^a] first.
    const shrunk = ["Text[^a].", "", "  [^1]: one", "[^a]: a", "", "- item"].join("\n");

    // Now: once = "Text.[^a]\n\n[^a]: a\n  [^1]: one\n\n- item",
    // twice = "Text.[^a]\n\n- item\n\n[^a]: a\n  [^1]: one".
    it.fails("shrunk: lint(lint(note)) equals lint(note)", () => {
        const once = lintFootnotes(shrunk);
        expect(lintFootnotes(once)).toBe(once);
    });

    // Now: the definitions are not gathered, and definitionsHoldingTheMoveBack gives [].
    it.fails("shrunk: after one lint, either the definitions are gathered or the move alert names one (never silent)", () => {
        const once = lintFootnotes(shrunk);
        if (/- item[\s\S]*\n\[\^a\]: [^\n]*\n {2}\[\^1\]:/.test(once)) return;
        expect(definitionsHoldingTheMoveBack(once)).not.toEqual([]);
    });
});

describe("the same with numbered footnotes cited in the other order", () => {
    // Gathered in the order written, "   [^2]: two" (three spaces) would
    // come first under the list item and join it. [^1] is cited first, so
    // reindex swaps the two, which puts " [^1]: one" (one space, outside
    // the item) first.
    const doc = "y[^1] x[^2]\n\n   [^2]: two\n\n [^1]: one\n\n- item";
    // The punctuation rule is off so the references stay where they are.
    const options = { fixPunctuation: false };

    it("control: the move alone, in the order written, refuses (the first block would join the item)", () => {
        expect(moveFootnoteDefinitionsToBottom(doc)).toBe(doc);
        expect(definitionsHoldingTheMoveBack(doc)).toContain("2");
    });

    // Now: once = "y[^1] x[^2]\n\n [^1]: one\n\n   [^2]: two\n\n- item",
    // twice = "y[^1] x[^2]\n\n- item\n\n [^1]: one\n   [^2]: two".
    it.fails("the default lint (minus punctuation) is idempotent", () => {
        const once = lintFootnotes(doc, options);
        expect(lintFootnotes(once, options)).toBe(once);
    });

    // Now: the definitions are not gathered, and definitionsHoldingTheMoveBack gives [].
    it.fails("after one lint, either the definitions are gathered or the move alert names one", () => {
        const once = lintFootnotes(doc, options);
        if (once.endsWith("[^1]: one\n   [^2]: two")) return;
        expect(definitionsHoldingTheMoveBack(once)).not.toEqual([]);
    });
});
