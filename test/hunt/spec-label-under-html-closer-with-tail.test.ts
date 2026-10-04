import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// spec question: when an HTML comment closes with text after the closer, as
// in "-->  tail text", is a label on the NEXT line a definition, or is it
// paragraph text under a prose line?
//
// Reading one, the block reading, which is what the code does today: the
// whole closer line belongs to the HTML block, so the label under it starts
// a definition. CommonMark 0.31.2 backs this up. An HTML block of type 2
// ends at the line holding "-->", and the rest of that line is part of the
// block, not a paragraph. micromark agrees: the label on the next line comes
// out as its own paragraph, meaning nothing was interrupted.
//
// Reading two, the prose reading: the text after "-->" is live, so the
// closer line reads as a paragraph line, and a label directly under a
// paragraph line is paragraph text too (the prose-label rule, sheet 14).
// Sheet 11 is the closest ground truth, and it only records that a reference
// placed after a mid-line "-->" is live. That is a fact about inline
// liveness, not about block structure, so it does not settle this. The "%%"
// closer sitting right beside this one in definitionStartLines already makes
// the distinction reading two asks for.
//
// What the user would see under reading two's complaint: the label would be
// treated as a real definition, so jumping to it, moving it to the bottom,
// and renumbering would all act on it, when Obsidian renders it as ordinary
// text.
//
// This needs a live Reading-view check in Obsidian before anyone changes
// anything.
//
// Hunt: 2026-09-13. Lens: contexts.
//
// Source of truth: CommonMark 0.31.2 section 4.6, HTML block type 2, and
// micromark's parse of the same three lines; manual sheets 11 and 14.

const starts = (lines: string[]) => {
    return readNote(lines).labelLines;
};

const lines = ["<!-- open", "-->  tail text", "[^1]: under prose"];

describe("spec question: a label under an HTML closer that carries a tail", () => {
    it.fails("reading two: the label under the closer line is paragraph text", () => {
        expect(starts(lines)).toEqual([false, false, false]);
    });

    it("control, today's behaviour: the label starts a definition", () => {
        expect(starts(lines)).toEqual([false, false, true]);
    });

    it("control: the %% closer already makes the distinction", () => {
        expect(starts(["%%", "hidden", "%% tail text", "[^1]: under prose"])).toEqual([
            false,
            false,
            false,
            false,
        ]);
        expect(starts(["%%", "hidden", "%%", "[^1]: a definition"])).toEqual([
            false,
            false,
            false,
            true,
        ]);
    });
});
