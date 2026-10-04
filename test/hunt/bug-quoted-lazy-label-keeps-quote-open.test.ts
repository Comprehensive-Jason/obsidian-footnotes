// Imported from the GLM 5.3 Flash cycle 4 hunt of 2026-09-16 (OpenCode worktree); 2 of 6 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// Hunt cycle 8 (GLM 5.3 Flash, 2026-09-16): a quoted LAZY label keeps the
// scanner's quote state "in a definition", so an indented quoted chunk
// after the blank quote line is read as live footnote text instead of
// quoted code.
//
// Scenario (a quote holding prose, a lazy label, a blank quote line, and an
// indented chunk citing a footnote):
//
//   > para
//   > [^1]: lazy
//   >
//   >     chunk[^73]
//
// What the user would see in Reading view: the label line is paragraph
// text (manual sheet 14's callout fixture proves a quoted label under a
// quoted body line renders as plain "[^1]: ..." prose, not a definition),
// so this is "after a plain quoted paragraph" - the chunk renders as
// quoted CODE with the literal string "chunk[^73]". The plugin's own
// pinned control says exactly that: "after a plain quoted paragraph it is
// quoted code" (test/hunt/bug-quoted-definition-chunk-after-gap.test.ts).
//
// What goes wrong: scanDocument sets quote.inDefinition from
// definitionLabelIn on the RAW line (markdown-scan.ts, the quoted-line
// branch: "quote.inDefinition = definitionLabelIn(src[i]) !== null ||
// ..."). The raw label is there, so the quote is treated as inside a
// definition even though definitionStartLines - which judges the MASKED
// twin, like every other label reader - says the label is lazy and starts
// nothing. The chunk then fails the "quoted code" test
// (quote.boundary && !quote.inDefinition) and stays live. The scanner's
// two readers disagree about the same lines, the exact shape the cycle-5
// pin fixed in the other direction.
//
// What the user would see from the plugin: the [^73] in the code chunk is
// counted as a live reference - reindex numbers it, the missing-definition
// alert names it, and with "Delete orphaned references" on, the lint cuts
// it out of the code text (ADR-0002: lint never touches code).
//
// Source of truth: manual sheet 14 (a quoted label directly under a quote
// or callout body line is lazy prose) + the pinned quoted-paragraph
// control in bug-quoted-definition-chunk-after-gap.test.ts.
//
// Settings involved: none (the scan itself); every rule inherits the
// misread.

import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

const LAZY = ["> para", "> [^1]: lazy", ">", ">     chunk[^73]"];

describe("a quoted lazy label does not keep the quote in a definition", () => {
    it("the indented quoted chunk after the blank quote line is quoted code", () => {
        expect(readNote(LAZY).protectedLines).toEqual([false, false, false, true]);
    });

    it("so the reference inside the chunk is dead text", () => {
        const lines = LAZY;
        expect(readNote(lines).referencesOn(3).map((o) => o.name)).toEqual([]);
    });

    it("control: the same chunk after a plain quoted paragraph is already quoted code", () => {
        const lines = ["> para", ">", ">     chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, true]);
    });

    it("control: directly after the lazy label line the chunk is a lazy continuation (live)", () => {
        // a blank quote line is what ends the paragraph; without it the
        // indented line is its lazy continuation, and live is correct
        const lines = ["> para", "> [^1]: lazy", ">     chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false]);
    });

    it("control: a REAL quoted definition keeps the chunk live, as pinned in cycle 5", () => {
        const lines = ["> [^1]: body", ">", ">     chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false]);
    });

    it("control: a real quoted definition's lazy continuation then chunk stays live", () => {
        const lines = ["> [^1]: body", "> cont", ">", ">     chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false, false]);
    });
});
