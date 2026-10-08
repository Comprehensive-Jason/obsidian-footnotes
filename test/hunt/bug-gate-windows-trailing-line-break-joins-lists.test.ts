import { describe, expect, it } from "vitest";

import { judgeEdit } from "../../src/editor/result-gate";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (wrong output): when a note ends in a line break, as most files do,
// the result gate passes a lint that moves a definition from between two
// lists, and the two lists join into one.
//
// What the user would see: "Steps", then the list "1. Mix", a blank line,
// "[^a]: by hand", a blank line, and the one-item list "1. Bake[^a]." that
// ends the note. Ctrl+S moves the reference past its period and the
// definition to the bottom: "1. Mix", a blank line, "1. Bake.[^a]". With
// nothing between them now, Reading view draws one list, and "Bake" shows
// as 2. The same goes for "- Mix" and "- Bake", which become one loose
// list. Without the final line break the lint holds the move, as it
// should.
//
// The "result gate" is the one check every edit passes before it is
// written: the note after must read the same as the note before, except
// for what the action meant to change. Its "edit windows" are the
// stretches of lines an edit can have changed, the only lines its checks
// look at.
//
// Hunt 2026-10-08, cycle 6. Cluster Z4.
//
// Origin: regression from 7790b9f (the lint's one judgment of the whole
// lint, which gives the gate this edit); the stretch defect itself has
// been in the gate since 87e0b19.
//
// Source of truth: docs/obsidian-reading-rules.md B9 (two lists with only
// blank lines between them are one list; anything else between them, a
// footnote definition included, keeps them apart, and the plugin refuses
// to join them), with the saved answer h2:cn2-lists-apart, this very shape
// with its definition between. The checked run (every change judged as it
// is made) holds the move.
//
// Cause: editWindows in src/editor/result-gate.ts lines the note before up
// with the note after to find what changed. With the line under the
// definition changed too (the punctuation move) and the note's final empty
// line to anchor on, it pairs the old definition line with the new one as
// unchanged. The changed "1. Bake" line then lands in one stretch as a
// line added and in another as a line taken out, and check 5 (the lines
// around the edit keep their block shape) compares neither. Without the
// final line break the same edit is refused on check 5.

describe("the lint does not join two lists around a definition at the end of the note", () => {
    // Now: "Steps\n\n1. Mix\n\n1. Bake.[^a]\n\n[^a]: by hand\n"
    it.fails("numbered: the second list keeps its own 1.", () => {
        const out = lintFootnotes("Steps\n\n1. Mix\n\n[^a]: by hand\n\n1. Bake[^a].\n");
        expect(out).toBe("Steps\n\n1. Mix\n\n[^a]: by hand\n\n1. Bake.[^a]\n");
    });

    // Now: "Steps\n\n- Mix\n\n- Bake.[^a]\n\n[^a]: by hand\n"
    it.fails("bullets: the two lists stay apart", () => {
        const out = lintFootnotes("Steps\n\n- Mix\n\n[^a]: by hand\n\n- Bake[^a].\n");
        expect(out).toBe("Steps\n\n- Mix\n\n[^a]: by hand\n\n- Bake.[^a]\n");
    });

    // The root pin: the gate on its own passes this edit (pass: true) when
    // the note ends in a line break.
    it.fails("the gate itself: moving the definition and changing the line under it is refused", () => {
        const before = "Steps\n\n1. Mix\n\n[^a]: by hand\n\n1. Bake[^a].\n".split("\n");
        const after = "Steps\n\n1. Mix\n\n1. Bake.[^a]\n\n[^a]: by hand\n".split("\n");
        expect(judgeEdit(before, after, { footnotesMoved: true }).pass).toBe(false);
    });

    it("control: without the final line break, the gate refuses the same edit", () => {
        const before = "Steps\n\n1. Mix\n\n[^a]: by hand\n\n1. Bake[^a].".split("\n");
        const after = "Steps\n\n1. Mix\n\n1. Bake.[^a]\n\n[^a]: by hand".split("\n");
        expect(judgeEdit(before, after, { footnotesMoved: true }).pass).toBe(false);
    });

    it("control: without the final line break, the lint holds the move", () => {
        const note = "Steps\n\n1. Mix\n\n[^a]: by hand\n\n1. Bake[^a].";
        expect(lintFootnotes(note)).toBe("Steps\n\n1. Mix\n\n[^a]: by hand\n\n1. Bake.[^a]");
    });
});
