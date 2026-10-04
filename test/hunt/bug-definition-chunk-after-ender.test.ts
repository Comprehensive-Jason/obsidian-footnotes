// Imported from the Kimi K3 cycle 5 hunt of 2026-09-16 (OpenCode worktree); 6 of 8 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// A footnote definition ends where a block of its own starts: a heading,
// a fenced code block at column 0, a link reference definition, or a
// setext underline that pulls the definition's lazy continuation out as a
// heading. An indented chunk after such a block is indented CODE, not the
// definition's continuation (verified with the micromark oracle for the
// heading and fence cases: footnoteDefinition("body"), then heading/fence,
// then code("chunk[^73]"); for the setext and LRD cases the Reading view
// probes are recorded - bug-setext-underline-makes-heading, and the
// blockEnder comment "a link reference definition is a block of its own").
//
// scanDocument's inDefinition never closes on those lines. It is re-decided
// only by blank lines, thematic breaks, and labels, so the definition
// "survives" the ender and the chunk after it reads as LIVE definition
// content. The fence branch's own comment claims the opposite ("an opener
// indented less than 4 columns runs the re-decide below [and resets
// inDefinition]") - the re-decide keeps it true.
//
// What the user sees: a "[^73]" in the chunk is dead text in Reading view
// but live to the plugin - the numbered command hands its number out
// again, reindex renumbers it, the orphan alert names it. Worse, the lint
// DEMOTES it retroactively: move-to-bottom moves the definition block
// (which correctly ends at the ender) and leaves the chunk behind, where
// it becomes standalone code - so the reference Reading view always
// counted as dead flips from live to dead inside one lint, which is how
// the conservation property caught it (FC seed 1232880226).
//
// Source of truth: micromark oracle (heading and fence cases: the chunk
// is a code block sibling of the definition) + the recorded Reading view
// probes (setext: bug-setext-underline-makes-heading; LRD: blockEnder's
// own comment, verified 2026-09-16).
//
// Settings involved: none for the scan; every rule inherits the misread.

describe("an indented chunk after a block that ended the definition is code, not a continuation", () => {
    it("after a heading", () => {
        const lines = ["[^1]: body", "# H", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, true]);
    });

    it("after a column-0 fence", () => {
        const lines = ["[^1]: body", "```", "code", "```", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, true, true, true, true]);
    });

    it("after a setext underline that pulled the lazy continuation out as a heading", () => {
        const lines = ["[^1]: body", "cont", "===", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false, true]);
    });

    it("after a link reference definition", () => {
        const lines = ["[^1]: body", "[foo]: /url", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, true]);
    });

    it("the reference in the chunk is dead (heading case)", () => {
        const lines = ["[^1]: body", "# H", "    chunk[^73]"];
        expect(readNote(lines).referencesOn(2)).toEqual([]);
    });

    it("the reference is dead in the ORIGINAL note too (the conservation counterexample)", () => {
        // FC seed 1232880226: "[^116]: body", "cont", "===", blank,
        // "    indented code[^73]". Reading view: "cont" is a heading, the
        // definition is "body", and the chunk is code - [^73] is dead.
        // The plugin reads it LIVE here, and only the move-to-bottom below
        // accidentally makes it dead, which is what the conservation
        // property flagged: one lint flipped a reference's liveness.
        const doc = "[^116]: body\ncont\n===\n\n    indented code[^73]";
        const lines = doc.split("\n");
        expect(readNote(lines).referencesOn(4)).toEqual([]);
    });

    it("control: a chunk after the definition's blank gap IS its continuation", () => {
        const lines = ["[^1]: body", "", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false]);
    });

    it("control: a thematic break closes the definition (thematicBreak is checked)", () => {
        const lines = ["[^1]: body", "---", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, true]);
    });
});
