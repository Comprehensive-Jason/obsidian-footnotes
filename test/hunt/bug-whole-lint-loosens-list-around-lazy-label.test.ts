import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";

// BUG (wrong output): with the default settings, the lint fixes a lazy
// label between two list items and moves the new definition to the bottom,
// which leaves a blank line between the items and turns a tight list loose.
//
// What the user would see: "Shopping list[^1]", a blank line, then
// "- apples", "[^1]: from the market", "- pears", "- plums". Ctrl+S writes
// "- apples", a blank line, "- pears", "- plums", and "[^1]: from the
// market" at the bottom. Reading view now draws every item of the list as
// a paragraph, with the wider spacing that gives, where before it drew
// three plain items. The same happens to "1. Mix", "[^1]: by hand",
// "1. Bake".
//
// A "label" is the "[^1]:" head of a definition. A "lazy" label is one
// typed with no blank line above it; between two list items Obsidian reads
// it as more of the first item's text. A "tight" list has no blank lines
// between its items; a "loose" one has, and Obsidian draws each item of a
// loose list as a paragraph.
//
// Hunt 2026-10-08, cycle 6. Cluster Z2. It shares a root with Z3
// (bug-second-lint-makes-held-fix-lazy): fix-lazy and the move to the
// bottom are judged only as one net change.
//
// Origin: regression from 7790b9f (the lint's one judgment of the whole
// lint).
//
// Source of truth: Jason's triage decision Q7 (2026-10-05): fix-lazy
// leaves a lazy label between list items lazy, and the lazy-label alert
// names it (spec-fix-lazy-swallows-next-item). Live Obsidian 1.14.4 on
// sprout (2026-10-08, Reading view): c6:z2-tight draws "- apples",
// "- pears", "- plums" as plain items, and c6:z2-loose, the same list with
// a blank line after "- apples", draws every item as a paragraph
// (docs/obsidian-reading-rules.md B10; c6:z2-ord-tight and c6:z2-ord-loose
// the same for "1. Mix", "1. Bake"). Fix-lazy alone, the lint with the
// move off, and the checked run (every change judged as it is made) all
// leave the note as it is.
//
// Cause: the lint first runs every rule with every change passed and asks
// the result gate once about the whole lint (gatedLint in
// src/linting/rule-gate.ts). Fix-lazy's blank line splits the list, but
// the move then takes the new definition away, and the gate compares only
// the note before the lint with the note after it. There the list items
// are the same items with the same block marks, and the note reading's
// line blocks do not tell a loose list from a tight one (B10), so the
// whole lint passes, and fix-lazy is never judged alone.

const Bullets = "Shopping list[^1]\n\n- apples\n[^1]: from the market\n- pears\n- plums";

describe("the default lint on a lazy label between list items (Q7)", () => {
    // Now: "Shopping list[^1]\n\n- apples\n\n- pears\n- plums\n\n[^1]: from the market"
    it.fails("bullets: the list keeps its items together, the label stays lazy", () => {
        expect(lintFootnotes(Bullets)).toBe(Bullets);
    });

    // Now: "Steps[^1]\n\n1. Mix\n\n1. Bake\n\n[^1]: by hand"
    it.fails("numbered items written 1. 1., as many people do: the label stays lazy", () => {
        const note = "Steps[^1]\n\n1. Mix\n[^1]: by hand\n1. Bake";
        expect(lintFootnotes(note)).toBe(note);
    });

    it("control: fix-lazy alone leaves it, as Q7 rules", () => {
        expect(fixLazyDefinitions(Bullets)).toBe(Bullets);
    });

    it("control: with the move off the lint leaves it too", () => {
        expect(lintFootnotes(Bullets, { moveDefinitionsToBottom: false })).toBe(Bullets);
    });
});
