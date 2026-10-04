// Imported from the glm-cycle-11 hunt of 2026-09-16 (OpenCode worktree); confirmed and fixed 2026-09-16.
// PROBED 2026-09-16 (GLM hunt cycle 11): "[^1]: body", "    cont", "para", "===", "    code[^9]" renders the footnote "body cont", the heading "para", and a code block, so the block walker was right and the reading's one-line walk now agrees.
// GLM 5.3 Flash cycle 11 hunt of 2026-09-16 (OpenCode worktree glm-cycle-11). 2 of 3 tests carry it.fails; the control does not.
import { describe, expect, it } from "vitest";


import { lintFootnotes } from "../../src/linting/linter";

import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION: where does a definition end when a setext underline follows
// a MIXED run - an indented continuation line and then a plain lazy line?
//
//     [^1]: body
//         cont
//     para
//     ===
//         code[^9]
//
// Two recorded Reading-view probes bear on it and they answer differently by
// mechanism. The cycle-12 probes ("a setext underline under a definition's
// LAZY line pulls that line out as a heading ... while under an INDENTED
// continuation the underline is the footnote's body text") read the line
// DIRECTLY above the underline: "para" is a plain lazy line, so the
// underline is a heading, the definition ends above it, and the chunk after
// the heading is indented code - "[^9]" is dead. The cycle-5 document-level
// probe ("a setext underline makes a heading of a ONE-line paragraph only")
// counts the paragraph's lines: the run above the underline is "cont" +
// "para" (two lines, the label's own text not counting per the cycle-12
// probes), so the underline is literal text, the footnote carries on, and
// the chunk after it is the footnote's live body - "[^9]" is live.
//
// The plugin implements BOTH answers in different readers, and they
// disagree on this exact shape. readNote(the label walk).labelLines ends
// the definition at the underline (its `open === "definition" &&
// setextUnderline` branch judges only the directly-above line, which is
// unindented -> open = "none"), and the block walker agrees (the block ends
// at the indented continuation, the lazy line refused because a setext
// underline follows it). scanDocument's own state machine instead runs
// oneLineParagraphAbove, which counts the indented "cont" as a paragraph
// line, gets 2, calls the underline literal, and keeps the definition open -
// so isProtected says the chunk is LIVE footnote text.
//
// What the user would see: the plugin hands the chunk's "[^9]" out as a
// taken number and reindexes it (its own protection facts call it live),
// while the lint's block walker treats the definition as ending at "para" -
// so the first lint moves the definition away from its tail, the chunk
// becomes code in the moved note, and the reference the plugin itself had
// been counting flips dead in one lint. Whichever way Reading view answers,
// one of the plugin's two readings is wrong; only a Reading-view probe of
// the mixed run can say which.
//
// Source of truth: the two recorded probes above (cycle 12 vs cycle 5,
// manual sheets 14/21) + the plugin's own two readers, quoted. Filed as a
// spec question per the hunt rules: where Reading view cannot be consulted,
// the disagreement is recorded, not judged.
//
// Settings involved: none for the reading; `Move definitions to the bottom`
// inherits whichever answer is wrong.

const doc = "[^1]: body\n    cont\npara\n===\n    code[^9]";

function facts(text: string) {
    const lines = text.split("\n");
    const reading = readNote(lines);
    const masked = [...readNote(lines).maskedLines()];
    const starts = readNote(lines).labelLines;
    return { reading, masked, starts, blocks: readNote(lines).blocks };
}

describe("a setext underline after a definition's indented continuation and lazy line", () => {
    it("the protection facts agree with the block walker about where the definition ends", () => {
        // the block walker and the label walk end the definition at the
        // underline (the directly-above line is a plain lazy line); the
        // protection facts must not keep the chunk after the heading live
        const { reading, blocks } = facts(doc);
        expect(blocks.map((b) => [b.start, b.end])).toEqual([[0, 1]]);
        expect(reading.protectedLines[4]).toBe(true);
    });

    it("the lint does not flip a reference it itself counted live", () => {
        // whichever reading is right, one lint must not change what the
        // plugin sees as live: the baseline counts [^9] (the chunk live per
        // the state machine), the lint's output protects the chunk (dead)
        const before = facts(doc);
        const chunk = 4;
        const liveBefore = before.reading.referencesOn(chunk).length;
        const out = lintFootnotes(doc, { fixPunctuation: false, fixLazyDefinitions: false, moveDefinitionsToBottom: true, reindex: false });
        const after = facts(out);
        const outChunk = out.split("\n").findIndex((l) => l.startsWith("    code"));
        const liveAfter = after.reading.referencesOn(outChunk).length;
        expect(liveAfter).toBe(liveBefore);
    });

    it("the underline heads the lazy line alone: footnote \"body cont\", heading \"para\", then code", () => {
        // probed in Reading view 2026-09-16; the reading's one-line walk now
        // stops counting at the definition's indented continuation
        const { reading, blocks } = facts(doc);
        expect(blocks.map((b) => [b.start, b.end])).toEqual([[0, 1]]);
        expect(reading.protectedLines).toEqual([false, false, false, false, true]);
    });
});
