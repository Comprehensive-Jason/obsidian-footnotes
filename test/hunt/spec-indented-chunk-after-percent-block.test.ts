// Imported from the GLM 5.3 Flash cycle 2 hunt of 2026-09-16 (OpenCode worktree); 2 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// REFUTED 2026-09-16 (GLM hunt cycle 2, probed in Reading view): the chunk under a closed "%%" block is the FOOTNOTE'S body ("body chunk", reference live); a "%%" block does not end a definition, unlike a comment, HTML, or math block. The two tests below now pin the plugin's reading as controls.
// SPEC QUESTION: does a closed "%%" block comment end a footnote
// definition block, the way a heading, a closed fence, a link reference
// definition, or a setext heading does? The indented chunk under the
// block is then indented code, not the definition's continuation.
//
// Scenario:
//
//   [^1]: body
//   %%
//   hidden
//   %%
//       code chunk [^73]
//
// What the plugin's own walkers say: they DISAGREE. definitionStartLines
// resets its state at the bare closer (open = "none", markdown-scan.ts
// comment "Its closer ends the block, so a label directly under a bare
// closer IS a definition"), and a label right after the closer IS a
// definition by Jason's verification of 2026-09-15 - both of which mean
// the %% block acts as a block ender. But scanDocument's inDefinition
// state never resets across the block (the opener line just opens the
// commentBlock and continues; the closer only sets blockBoundary), so the
// indented chunk fails the `indented && !inDefinition` code test and is
// read as LIVE definition content. The test below pins the micromark-
// consistent reading (chunk = code); it fails today, which is exactly the
// disagreement.
//
// What the user would see if Reading view agrees: the chunk renders as a
// code block with the literal string "code chunk [^73]", while the plugin
// treats the [^73] as a live reference - it is counted, renumbered, and
// named by the orphan alert, and with "Delete orphaned references" on the
// lint cuts it out of the code chunk.
//
// Why a spec question and not a bug pin: no manual sheet or recorded
// probe pins what Reading view does with an indented chunk directly under
// a closed %% block comment that follows a definition. The pinned facts
// nearby (sheet 11: the block comment's lines are hidden but its
// references are live; Jason's 2026-09-15 verification: a label after the
// bare closer renders as a definition) all point at "the block ended the
// definition", but the chunk itself was never probed. The sibling HTML
// block flavors are pinned as bugs in
// bug-indented-chunk-after-html-block.test.ts, where sheet 14 grounds the
// block reading.
//
// NEEDS A LIVE CHECK: in Reading view, does the note above render the
// last line as a code block (with "code chunk [^73]" shown literally), or
// as the footnote body's continuation?
//
// Settings involved: none for the scan; every rule inherits the misread
// if Reading view says code.

import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

describe("spec: a closed %% block comment under a definition ends it", () => {
    it("REFUTED: the indented chunk after the closed block is the footnote's body, not code", () => {
        const lines = ["[^1]: body", "%%", "hidden", "%%", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([
            false,
            false,
            false,
            false,
            false,
        ]);
    });

    it("REFUTED: so the reference inside it is live", () => {
        const lines = ["[^1]: body", "%%", "hidden", "%%", "    chunk[^73]"];
        expect(readNote(lines).referencesOn(4).map((o) => o.name)).toEqual(["73"]);
    });

    it("control: the label-after-closer fact the scan already holds", () => {
        // Jason's verification 2026-09-15, pinned in definitionStartLines:
        // "%% c" then "%% [^3]: def" renders the definition. That only
        // makes sense if the block ended whatever came before, which is
        // the reading this spec question asks Reading view to confirm for
        // the indented chunk.
        const lines = ["%% c", "%% [^3]: def", "    body of the definition"];
        expect(readNote(lines).labelLines[1]).toBe(true);
    });
});
