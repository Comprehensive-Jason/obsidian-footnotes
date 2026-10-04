// Imported from the GLM 5.3 Flash cycle 4 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// Hunt cycle 8 (GLM 5.3 Flash, 2026-09-16): the block walker does not own
// the indented chunk that follows a "%%" block comment sitting inside a
// definition, so move-to-bottom strands the footnote's body and the body
// turns into code.
//
// Scenario (a definition, a closed %% block, a blank, an indented
// continuation, a reference further down):
//
//   [^1]: body
//   %%
//   hidden
//   %%
//
//       chunk[^73]
//
//   text [^1]
//
// What Reading view shows (PROBED, not guessed): the chunk under the
// closed "%%" block is the FOOTNOTE'S BODY and the reference in it is
// live. That was settled by GLM hunt cycle 2 and recorded as REFUTED in
// test/hunt/spec-indented-chunk-after-percent-block.test.ts, and again in
// the cycle-6 fix ("a closed %% block does NOT end a definition; the
// chunk after it is the footnote's body"). This pin does NOT re-report
// that shape: scanDocument already implements it (inDefinition survives
// the block, so the chunk is live in the note as written - the control
// below holds).
//
// What goes wrong: findDefinitionBlocks - the walker move-to-bottom, both
// orphan rules, and reindex read extents from - ends the block at the
// label line. Its gap rule ("a run of blanks continues the block only
// when indented content follows") finds the %% block instead of indented
// content, its region-absorb branch only swallows comment lines when the
// block is ALREADY inside the definition, and "%%" is excluded from
// lazyContinuation. So the block is [{ name: "1", start: 0, end: 0 }]
// while the reading's own definition state runs through line 5: the two
// readers disagree about where footnote 1 ends.
//
// What the user sees from the plugin: with "Move definitions to the
// bottom" on, the lint relocates "[^1]: body" to the note's end and
// leaves the chunk behind. In the moved note the chunk no longer has a
// definition above the %% block, so it re-scans - and renders - as
// indented CODE: the footnote's body text silently stops being part of
// the footnote, and the live reference [^73] inside it dies. The same
// stranding bites "Delete orphaned definitions" (it cuts the label line
// of an orphaned definition and strands the body the same way).
//
// Source of truth: the cycle-2 probe recorded in
// spec-indented-chunk-after-percent-block.test.ts (probed in Reading
// view) and the cycle-6 fix note in the hunt brief; the walker must own
// what the reading says the definition owns, the same way it owns a region
// a continuation line opened (Sol bug #3) and a code span interior
// (cycle 4).
//
// Settings involved: "Move definitions to the bottom" (default on) for
// the consequence test; the walker itself is setting-free.

import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

import { readNote } from "../../src/parsing/note-reading";

const LINES = [
    "[^1]: body",
    "%%",
    "hidden",
    "%%",
    "",
    "    chunk[^73]",
    "",
    "text [^1]",
];

describe("the block walker owns the chunk after a %% block inside a definition", () => {
    it("the block runs from the label through the indented chunk", () => {
        expect(readNote(LINES).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([
            { name: "1", start: 0, end: 5 },
        ]);
    });

    it("the reading agrees the chunk is live in the note as written (the settled probe)", () => {
        expect(readNote(LINES).protectedLines).toEqual([
            false,
            false,
            false,
            false,
            false,
            false,
            false,
            false,
        ]);
    });

    it("move-to-bottom leaves the body the footnote's body: the moved note still reads the chunk live", () => {
        const moved = moveFootnoteDefinitionsToBottom(LINES.join("\n"));
        const lines = moved.split("\n");
        const at = lines.indexOf("    chunk[^73]");
        expect(at).toBeGreaterThan(-1);
        const reading = readNote(lines);
        expect(reading.protectedLines[at]).toBe(false);
        const masked = [...readNote(lines).maskedLines()];
        // the masked twin keeps live text, so a live reference is still
        // there to read (the pin's original assertion had this inverted)
        expect(
            masked[at].includes("[^73]"),
            "the reference in the chunk must stay live in the moved note",
        ).toBe(true);
    });

    it("control: the HTML-comment twin DOES end the definition (pinned cycle 2), and the move leaves code as code", () => {
        const twin = [
            "[^1]: body",
            "<!-- c -->",
            "",
            "    chunk[^73]",
            "",
            "text [^1]",
        ];
        const reading = readNote(twin);
        expect(reading.protectedLines).toEqual([false, true, false, true, false, false]);
        expect(readNote(twin).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([
            { name: "1", start: 0, end: 0 },
        ]);
        const moved = moveFootnoteDefinitionsToBottom(twin.join("\n"));
        const lines = moved.split("\n");
        const at = lines.indexOf("    chunk[^73]");
        expect(readNote(lines).protectedLines[at]).toBe(true);
    });
});
