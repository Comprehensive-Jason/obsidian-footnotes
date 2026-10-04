// Imported from the GLM 5.3 Flash cycle 2 hunt of 2026-09-16 (OpenCode worktree); 10 of 13 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// BUG: a block that interrupts a footnote definition does not end the
// definition in scanDocument's inDefinition state, so an indented chunk
// under the block is read as LIVE definition content when Reading view
// renders it as indented code.
//
// Scenario: a definition line (or its lazy continuation), then an
// interrupting block directly under it, then a four-space indented chunk:
//
//   [^1]: body
//   <!-- c -->
//       code chunk [^73]
//
// What the user sees in Reading view: the comment renders as nothing (a
// block, per manual sheet 14: "an HTML comment line is a block ... a label
// under it is a definition", so the block ended the definition), and the
// indented line renders as a code block with the literal text
// "code chunk [^73]". The micromark oracle agrees for every flavor below:
// one-line comment, multi-line comment block, type-6 <div> block, and a
// "$$" display-math block each leave "    chunk[^73]" as
// <pre><code>chunk[^73]</code></pre> (run with
// micromark-extension-gfm-footnote and -math from node_modules). The
// plugin's own contract says the same (markdown-scan.ts:1132-1135: only
// "a chunk indented by four spaces or a tab that opens at a block
// boundary outside any definition" is code), and the recorded Reading
// view probes agree for every flavor: a label under an HTML comment line
// is a definition (sheet 14), a label under a "$$" closer is a definition
// (markdown-scan.ts:2447, Claude sweep verified in Reading view), and a
// label under a <div> block defines nothing (Kimi cycle 1 probe) - in
// each case the interrupting block ended whatever came before.
//
// What goes wrong: blockEnder (markdown-scan.ts:1095) knows headings,
// thematic breaks, setext underlines, and link reference definitions, but
// not HTML blocks or math blocks; the comment, math, and %% region
// branches keep `inDefinition` alive on purpose for regions opened by a
// continuation line (Sol bug #3), and that survival wrongly extends to
// regions and blocks opened at COLUMN 0 directly under the definition.
// The chunk then fails the `indented && !inDefinition` code test and is
// left out of the masked twin, so the reference-shaped string inside it
// wakes up. The same family as the pinned heading/fence/LRD/setext enders
// in bug-definition-chunk-after-ender.test.ts; the interrupting-block
// flavors were not in that fix.
//
// What the user sees from the plugin: the [^73] in the chunk is counted
// as a live reference with no definition - the missing-definition alert
// names it, reindex renumbers the code text (with "Move definitions to
// the bottom" off), and "Delete orphaned references" cuts it out of the
// chunk, though ADR-0002 and Jason's 2026-08-10 ruling say lint never
// touches code. With the move ON the harm hides one step: move-to-bottom
// relocates the definition below the chunk (the block walker correctly
// ends the block at the comment), the re-scanned note then reads the
// chunk as code, and the reference's liveness flips from live to dead
// inside one lint - the same conservation counterexample shape the
// pinned cycle-5 enders were caught by.
//
// Settings involved: the scan facts themselves; "Move definitions to the
// bottom" OFF (a supported combo, the manual lint-rules tests, sections B and C) with
// Reindex or "Delete orphaned references" ON for the consequence tests.

import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes } from "../../src/linting/linter";

import { readNote } from "../../src/parsing/note-reading";

// everything off except the one rule under test
const only = (options: {
    reindex?: boolean;
    removeOrphanedReferences?: boolean;
}) => ({
    fixPunctuation: false,
    fixLazyDefinitions: false,
    moveDefinitionsToBottom: false,
    reindex: options.reindex ?? false,
    removeOrphanedReferences: options.removeOrphanedReferences ?? false,
});

describe("an interrupting block ends the definition, so the chunk under it is code", () => {
    it("after a one-line HTML comment", () => {
        const lines = ["[^1]: body", "<!-- c -->", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, true, true]);
    });

    it("after a multi-line HTML comment block", () => {
        const lines = ["[^1]: body", "<!-- c", "-->", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, true, true, true]);
    });

    it("after a type-6 HTML block (<div>) closed by a blank line", () => {
        const lines = ["[^1]: body", "<div>", "x", "", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, true, true, false, true]);
    });

    it("after a $$ display-math block", () => {
        // the "$$" lines are part of the math block, as a fence's lines are
        // part of its code block (the note reading, runtime swap step 2,
        // 2026-10-03)
        const lines = ["[^1]: body", "$$", "x", "$$", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, true, true, true, true]);
    });

    it("after a comment that interrupts the definition's lazy continuation", () => {
        const lines = ["[^1]: body", "lazy cont", "<!-- c -->", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, true, true]);
    });

    it("after a quoted comment inside a quoted definition", () => {
        // the same shape one container deeper: micromark renders the
        // quoted chunk as code inside the blockquote
        const lines = ["> [^1]: body", "> <!-- c -->", ">     chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, true, true]);
    });

    it("control: the same chunk after a comment under PROSE is already code", () => {
        const lines = ["para", "<!-- c -->", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, true, true]);
    });

    it("control: the chunk after the definition's blank gap IS its continuation", () => {
        const lines = ["[^1]: body", "", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, false, false]);
    });

    it("control: a region opened at the continuation indent stays definition content", () => {
        // Sol bug #3: a "    $$" on a continuation line is content the
        // definition owns, and the definition carries on after its closer
        const lines = ["[^1]: body", "    $$", "    x", "    $$", "    chunk[^73]"];
        expect(readNote(lines).protectedLines).toEqual([false, true, true, true, false]);
    });

    it("the reference in the chunk counts as live (one-line comment case)", () => {
        const lines = ["[^1]: body", "<!-- c -->", "    chunk[^73]"];
        expect(readNote(lines).referencesOn(2)).toEqual([]);
    });

    it("reindex renumbers the dead reference inside the code chunk", () => {
        const doc = "use[^1] here\n\n[^1]: body\n<!-- c -->\n    chunk[^73]";
        // [^73] is dead code text in Reading view: reindex must leave it,
        // but the scan shows a live reference in the chunk's slot after
        // [^1], so the code text is rewritten to [^2]
        expect(
            lintFootnotes(doc, only({ reindex: true })),
        ).toBe(doc);
    });

    it("and delete-orphaned-references cuts text out of the code chunk", () => {
        const doc = "use[^1] here\n\n[^1]: body\n<!-- c -->\n    chunk[^73]";
        expect(
            lintFootnotes(doc, only({ removeOrphanedReferences: true })),
        ).toBe(doc);
    });

    it("the numbered press's autonumber skips the dead reference in the chunk", async () => {
        const lines = ["use[^1] here", "", "[^1]: body", "<!-- c -->", "    chunk[^73]"];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 12 }, wholeDoc: true, edits: true });
        await insertAutonumFootnote(
            fakePlugin({ insertAtEndOfWord: false, enablePopupEditor: false, lintOnFootnoteCreation: false }, doc),
        );
        // sheet 11: dead reference-shaped text reserves no number, so the
        // press must mint [^2]; the misread chunk makes it mint [^74]
        expect(doc.lines[0]).toBe("use[^1] here[^2]");
    });
});
