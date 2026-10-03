import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";

// spec question: when a note starts with a UTF-8 byte order mark, does a
// definition label on line 0 still count as a definition?
//
// A byte order mark is an invisible character that some editors put at the
// very start of a file. It sits in front of line 0, so a label written at
// the start of that line is no longer at column 0 as far as the plugin's
// scanner is concerned, and stops reading as a definition.
//
// Reading one, the BOM is not part of the text: every CommonMark
// implementation strips a leading byte order mark before parsing, and
// Obsidian is built on that family of parsers. On this reading the label IS
// a definition, the plugin disagrees with what the user sees rendered, and
// the rewrite below destroys a real definition.
//
// Reading two, the BOM is an ordinary character: then the line really does
// begin with an invisible character, Obsidian reads it the same way the
// plugin does, and the rewrite is merely surprising rather than wrong.
//
// NEEDS A LIVE CHECK: two things settle this and neither is recorded
// anywhere - whether Obsidian strips a leading byte order mark before
// parsing a note, and whether its editor even holds one after a save.
//
// What the user would see today: the punctuation rule reads the label's
// "[^1]" as an ordinary reference sitting in front of a colon and hops it
// across, so their definition line "[^1]: def" is rewritten to ":[^1] def".
// With "Delete orphaned references" also on, the definition is gone as far
// as the rules are concerned, so both "[^1]"s are then erased and the
// footnote's text is left as a stray ": def" line.
//
// Hunt: 2026-09-13. Lens: the rule catalogue.
//
// Source of truth: CommonMark's leading-BOM handling as the reading the
// question turns on, and the plugin's own policy that a lint never destroys
// what the user wrote (ADR-0002, never-silent).

// "\ufeff" is the byte order mark
const BOM = "\ufeff";

describe("spec question: a definition label on line 0 behind a byte order mark", () => {
    it("survives a lint", () => {
        const doc = `${BOM}[^1]: def\n\nProse[^1].\n`;
        expect(lintFootnotes(doc, {})).toContain("[^1]: def");
    });

    it("is not treated as an orphaned reference and erased", () => {
        const doc = `${BOM}[^1]: def\n\nProse[^1].\n`;
        expect(lintFootnotes(doc, { removeOrphanedReferences: true })).toContain("[^1]");
    });

    it("control: the same note without the byte order mark lints correctly", () => {
        const doc = "[^1]: def\n\nProse[^1].\n";
        expect(lintFootnotes(doc, { fixPunctuation: false })).toBe("Prose[^1].\n\n[^1]: def\n");
    });

    it("control: a byte order mark in front of PROSE changes nothing", () => {
        // only a construct that has to start at column 0 is affected, so
        // this pins how narrow the question is: the same note with and
        // without the mark lints to the same thing (the punctuation rule
        // moving the reference past the full stop is its ordinary work)
        const plain = "Prose[^1].\n\n[^1]: def\n";
        expect(lintFootnotes(BOM + plain, {})).toBe(BOM + lintFootnotes(plain, {}));
    });
});
