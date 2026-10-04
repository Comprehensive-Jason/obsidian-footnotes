// Imported from the Kimi K3 cycle 5 hunt of 2026-09-16 (OpenCode worktree); 4 of 6 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// Obsidian turns a setext underline into a heading only when ONE line
// sits above it: "para", "more", "===" renders as a paragraph with a
// literal "===" (Kimi hunt cycle 3, probed in Reading view 2026-09-16).
// The plugin's own definitionStartLines knows - paragraphLinesAbove
// counts the run and only lets a one-line paragraph be underlined.
//
// scanDocument's blockEnder never got the one-line rule. It sees "==="
// under ANY open paragraph as a block ender, so the block ends there and
// an indented chunk on the next line opens as indented CODE. Reading
// view keeps the paragraph open (the "===" is literal text), and an
// indented line after a paragraph line is a lazy continuation - indented
// code cannot interrupt a paragraph, the very rule the scan relies on
// everywhere else. So a reference in the chunk is LIVE to Obsidian and
// DEAD to the plugin: reindex skips it, the numbered command hands its
// number out again, the press guard refuses there, and the orphan alert
// never names it.
//
// What the user sees: they write a two-line paragraph, a line of equals
// signs (a literal divider, say), and an indented code block with a
// "[^1]" in it - wait, no: Reading view shows the "[^1]" as a LIVE
// footnote reference with no definition, but the lint never warns about
// it, and the next numbered footnote the plugin inserts reuses [^1],
// colliding with it.
//
// Source of truth: the cycle-3 Reading view probe (setext only under one
// line) + the plugin's own definitionStartLines/paragraphLinesAbove,
// which reads the same "===" as literal - the two readers in
// markdown-scan.ts disagree about the same line.
//
// Settings involved: none (the scan itself).

describe("a setext-shaped line under a two-line paragraph is literal text, so an indented chunk after it is live", () => {
    it("the indented chunk after 'para','more','===' is not protected", () => {
        const lines = ["para", "more", "===", "    chunk[^1]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false, false]);
    });

    it("the reference in the chunk is live", () => {
        const lines = ["para", "more", "===", "    chunk[^1]"];
        expect(readNote(lines).referencesOn(3).map((o) => o.name)).toEqual(["1"]);
    });

    it("the same inside a blockquote", () => {
        const lines = ["> para", "> more", "> ===", ">     chunk[^1]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false, false]);
    });

    it("control: under a ONE-line paragraph the chunk is code (the one-line rule)", () => {
        const lines = ["para", "===", "    chunk[^1]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, true]);
    });

    it("control: a three-dash run is a thematic break either way", () => {
        const lines = ["para", "more", "---", "    chunk[^1]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false, true]);
    });

    it("a code span crosses the literal '===' inside the paragraph (paragraphGoesOn has the same miss)", () => {
        // "para `code" / "mo[^2]re" / "===" / "span` [^1]": the "===" is
        // literal, the paragraph continues, and the span from "`code"
        // closes at "span`" - so [^2] is dead (inside the span) and [^1]
        // is live (after it). The walk stops at the "===", reads no span
        // at all, and both come back live.
        const lines = ["para `code", "mo[^2]re", "===", "span` [^1]"];
        expect(readNote(lines).referencesOn(1).map((o) => o.name)).toEqual([]);
        expect(readNote(lines).referencesOn(3).map((o) => o.name)).toEqual(["1"]);
    });
});
