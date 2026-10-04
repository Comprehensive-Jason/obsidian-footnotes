// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 4 of 6 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";

// A footnote definition's continuation paragraph after a BLANK line needs
// four spaces of indent (CommonMark's footnote rules, and micromark's
// GFM-footnote oracle agrees: "[^1]: x", blank, "   y" parses "y" as a
// NEW paragraph outside the definition, while "    y" stays inside). The
// block walker's blank-gap branch tests IndentedContent (/^\s+\S/), which
// accepts ONE space, so a line indented one to three spaces after the gap
// is swallowed into the definition block. The quoted-definition walk
// (quotedDefinitionEnd) requires /^ {4}/ for the very same decision, so
// the walker contradicts its own sibling here.
//
// What the user sees, with "Delete orphaned definitions" ON: a note like
// "[^9]: stray", blank, "   important prose", blank, "text" lints to
// "text" - the prose paragraph is deleted as if it were the stray
// footnote's body, which it never was. Silent destruction of live text.
// With move-to-bottom, the same paragraph is dragged to the bottom glued
// under the definition, when only the definition should have moved.
//
// Source of truth: the micromark + mdast-util-gfm-footnote oracle in
// node_modules (the repo's designated referee; no manual sheet records
// Reading view disagreeing with it here), CommonMark's indented-
// continuation rule, and the plugin's own quotedDefinitionEnd (/^ {4}/
// for the identical blank-gap question).
//
// Settings involved: `Delete orphaned definitions` ON for the text loss;
// `Move definitions to the bottom` (default ON) for the misplacement.

describe("a 1-3 space indented line after a definition's blank gap is NOT its continuation", () => {
    it("the block walker ends the block at the blank line", () => {
        const lines = "[^9]: stray\n\n   important prose\n\ntext".split("\n");
        const blocks = readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }));
        expect(blocks).toEqual([{ name: "9", start: 0, end: 0 }]);
    });

    it("orphan deletion keeps the prose paragraph (no live text lost)", () => {
        // the pin's original expectation reordered the paragraphs; the
        // cut leaves them where they were
        const doc = "[^9]: stray\n\n   important prose\n\ntext";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe("   important prose\n\ntext");
    });

    it("move-to-bottom moves only the definition, not the prose paragraph", () => {
        const doc = "intro\n\n[^1]: def\n\n   important prose\n\ntail[^1]";
        expect(moveFootnoteDefinitionsToBottom(doc)).toBe(
            "intro\n\n   important prose\n\ntail[^1]\n\n[^1]: def",
        );
    });

    it("a label under such a line is lazy, not a definition (definitionStartLines agrees)", () => {
        // "   y" is a new paragraph outside the definition, so "[^2]: z"
        // directly under it is a lazy label; fix-lazy must give it a blank
        const doc = "[^1]: x\n\n   y\n[^2]: z";
        expect(fixLazyDefinitions(doc)).toBe("[^1]: x\n\n   y\n\n[^2]: z");
    });

    it("control: four spaces after the gap IS a continuation (micromark agrees)", () => {
        const lines = "[^9]: stray\n\n    real continuation\n\ntext".split("\n");
        const blocks = readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }));
        expect(blocks).toEqual([{ name: "9", start: 0, end: 2 }]);
    });

    it("control: a non-blank lazy continuation line stays (micromark: paragraph reads \"x\\ny\")", () => {
        const lines = "[^9]: stray\n lazy continuation\n\ntext".split("\n");
        const blocks = readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }));
        expect(blocks).toEqual([{ name: "9", start: 0, end: 1 }]);
    });
});
