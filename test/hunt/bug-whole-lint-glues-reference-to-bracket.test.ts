import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";

// BUG (data loss with Delete orphaned definitions on; wrong output
// otherwise): under Before punctuation, the lint moves a reference that
// follows "[sic]." in front of the period, glued to the "]", where it stops
// being a footnote; with Delete orphaned definitions on, the same lint then
// deletes the footnote's definition.
//
// What the user would see: Footnote placement "Before punctuation", the
// note "He said it was fine [sic].[^1]" with "[^1]: Quoted as written."
// typed straight under it. Ctrl+S writes "He said it was fine [sic][^1].",
// and Reading view shows "[sic][^1]" as plain text, with no footnote 1.
// With Delete orphaned definitions on, even the ordinary note with a blank
// line above the definition and "More text here." under it loses
// "[^1]: Quoted as written." in that one lint: the footnote's text is gone.
//
// A "label" is the "[^1]:" head of a definition. A "lazy" label is one
// typed straight under a paragraph's text, which Obsidian reads as more of
// that paragraph; the lint's fix-lazy rule adds the blank line above it
// that makes it a definition. A "reference link" is "[text][label]",
// Markdown's other way to write a link; "[sic][^1]" reads as one.
//
// Hunt 2026-10-08, cycle 6. Cluster Z1.
//
// Origin: regression from 7790b9f (the lint's one judgment of the whole
// lint); every test here is green at 10d599d and at 24ef25f.
//
// Source of truth: docs/obsidian-reading-rules.md D7 (a reference glued
// after the "]" of bracketed text is a reference link, dead text; the
// saved answers swap34:br-*); ADR 0003 (an edit passes only when the note
// reads the same except for what the action meant: fix-lazy means a
// definition, the punctuation rule means a move, neither means a dead
// reference); ADR 0002 (a change the lint holds back is named, not made).
// The checked run, where every change is judged as it is made, holds the
// move, and so does the whole lint on the first shape with its blank line
// already in place (the control).
//
// Cause: the lint first runs every rule with every change passed, gathers
// what each change meant, and asks the result gate once about the whole
// lint (gatedLint in src/linting/rule-gate.ts). The gathered intent lists
// the footnotes fix-lazy defines and the ones the orphan rule removes, and
// the gate's check 1 (every footnote the action did not mean to change
// keeps its references and definitions) then skips those footnotes for
// every rule's change, the punctuation rule's included. So footnote 1's
// reference dying in the punctuation move goes unseen: in the first shapes
// because fix-lazy defined footnote 1, in the last because the orphan rule
// removed the definition the dead reference left behind.

const before = { placement: "before" as const };

describe("the whole lint under Before punctuation, a reference after [sic].", () => {
    // Now: "He said it was fine [sic][^1].\n\n[^1]: Quoted as written."
    it.fails("a lazy label: the reference after [sic]. is not glued to the bracket", () => {
        const out = lintFootnotes("He said it was fine [sic].[^1]\n[^1]: Quoted as written.", before);
        expect(out).not.toContain("[sic][^1]");
        expect(out).toBe("He said it was fine [sic].[^1]\n\n[^1]: Quoted as written.");
    });

    // Now: "He said it was fine [sic][^1].\n\nMore text here.", the
    // definition deleted.
    it.fails("a lazy label, Delete orphaned definitions on: the definition's text is not deleted in the same lint", () => {
        const out = lintFootnotes("He said it was fine [sic].[^1]\n[^1]: Quoted as written.\n\nMore text here.", { ...before, removeOrphanedDefinitions: true });
        expect(out).toContain("[^1]: Quoted as written.");
        expect(out).not.toContain("[sic][^1]");
    });

    // Now: "> He said it was fine [sic][^1].\n>\n> [^1]: Quoted as written."
    it.fails("a lazy label in a quote: the reference is not glued to the bracket", () => {
        const out = lintFootnotes("> He said it was fine [sic].[^1]\n> [^1]: Quoted as written.", before);
        expect(out).not.toContain("[sic][^1]");
    });

    // No lazy label at all. The punctuation move kills the reference, the
    // orphan rule deletes the definition nothing references now, and the
    // one judgment skips footnote 1 as removed. Now: "He said it was fine
    // [sic][^1].\n\nMore text here."
    it.fails("an ordinary note, Delete orphaned definitions on: one lint keeps the reference live and the definition", () => {
        const out = lintFootnotes("He said it was fine [sic].[^1]\n\n[^1]: Quoted as written.\n\nMore text here.", { ...before, removeOrphanedDefinitions: true });
        expect(out).toBe("He said it was fine [sic].[^1]\n\nMore text here.\n\n[^1]: Quoted as written.");
    });

    it("control: with the blank line already there, the lint holds the move", () => {
        const note = "He said it was fine [sic].[^1]\n\n[^1]: Quoted as written.";
        expect(lintFootnotes(note, before)).toBe(note);
    });
});
