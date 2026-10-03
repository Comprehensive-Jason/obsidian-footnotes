// Imported from the GLM 5.3 Flash cycle 4 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// Hunt cycle 8 (GLM 5.3 Flash, 2026-09-16): a quoted definition's
// continuation written with a TAB is not owned by the definition after a
// blank quote line - quotedDefinitionEnd measures the continuation indent
// with a literal four-SPACE pattern.
//
// Scenario (a quoted definition, a blank quote line, a tab-indented
// continuation):
//
//   > [^1]: body
//   >
//   >	continuation[^73]
//
// (the last line is ">", TAB, "continuation[^73]".)
//
// What Reading view shows: the tab is four columns of indent, exactly as
// the plugin itself reads it everywhere else - leadingIndentWidth expands
// tabs to tab stops, and the pinned tab probes ("a tab after a quote
// marker's space gives code") measure the SAME way. The micromark oracle
// in node_modules agrees: fromMarkdown with the GFM footnote extension
// parses the tab twin into the very same footnoteDefinition with a second
// paragraph "continuation[^73]" as the space twin ">     continuation"
// - the body is the footnote's, and the reference in it is live.
//
// What goes wrong: quotedDefinitionEnd's blank-gap rule accepts the
// continuation after the empty quote lines only when "/^ {4}/" matches
// the line after the quote markers - four literal SPACES. A tab fails
// the pattern, so the definition's extent stops at the label and the
// tab-indented line is treated as a quote of its own. The scan's own
// quoted live-path handles the tab fine (leadingIndentWidth), and
// findDefinitionBlocks' column-0 gap rule uses leadingIndentWidth too -
// quotedDefinitionEnd is the one literal-spaces reader.
//
// What the user would see from the plugin: with "Delete orphaned
// definitions" on, deleting the quoted orphan cuts the label line and
// strands the tab-indented body (the exact bug the space twin's fix
// closed in bug-quoted-orphan-deletion-strands-body.test.ts), the
// stranded body re-reads as quoted code, and the [^73] it was keeping
// alive dies one lint later. The jump and the press guards
// (quotedDefinitionLabelAbove) likewise cannot place a caret on the tab
// line inside the definition.
//
// Source of truth: the micromark + mdast-util-gfm-footnote oracle in
// node_modules (tab twin and space twin parse identically), the plugin's
// own tab-as-columns rulings (leadingIndentWidth; the pinned tab-after-
// quote-marker probes), and the fixed space-twin behavior. Micromark's
// known disagreement with Obsidian (definitions interrupting paragraphs)
// does not touch continuation indent, and the space twin is already
// fixed per the same reading.
//
// Settings involved: "Delete orphaned definitions" for the consequence
// test; quotedDefinitionEnd itself is setting-free.

import { readNote } from "../../src/parsing/note-reading";
import { describe, expect, it } from "vitest";

import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// ">\tcont" - the quote marker, then a TAB, then the continuation text.
const TAB_LINES = ["> [^1]: body", ">", ">\tcont"];
const SPACE_LINES = ["> [^1]: body", ">", ">     cont"];

const extentOf = (lines: string[]): number => readNote(lines).labelOn(0)?.end ?? 0;

describe("a tab-indented quoted continuation belongs to the definition", () => {
    it("quotedDefinitionEnd measures the tab as four columns, like the space twin", () => {
        expect(extentOf(SPACE_LINES)).toBe(2);
        expect(extentOf(TAB_LINES)).toBe(2);
    });

    it("deleting the quoted orphan takes the tab-indented body with it, like the space twin", () => {
        const tab = "para.\n\n> [^9]: stray\n>\n>\tbody cites[^b]\n\n[^b]: bee";
        const space = "para.\n\n> [^9]: stray\n>\n>     body cites[^b]\n\n[^b]: bee";
        expect(removeOrphanedFootnoteDefinitions(tab)).toBe(
            removeOrphanedFootnoteDefinitions(space),
        );
        expect(removeOrphanedFootnoteDefinitions(tab)).toBe("para.");
    });

    it("control: directly after the label line the tab continuation is already owned", () => {
        // without the blank quote line the quoted live-path (which is
        // tab-aware) owns the line; only the blank-gap rule is literal
        const lines = ["> [^1]: body", ">\tcont"];
        expect(extentOf(lines)).toBe(1);
    });

    it("control: the space twin goes whole (the pinned space-twin fix)", () => {
        const space = "para.\n\n> [^9]: stray\n>\n>     body cites[^b]\n\n[^b]: bee";
        expect(removeOrphanedFootnoteDefinitions(space)).toBe("para.");
    });
});
