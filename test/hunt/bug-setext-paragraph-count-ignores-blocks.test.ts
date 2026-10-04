// Imported from the glm-cycle-8 hunt of 2026-09-16 (OpenCode worktree); all pins flipped green 2026-09-16 after the fix.
// RESOLVED 2026-09-16 (GLM hunt cycle 8, all five shapes probed in Reading view: a heading, a rule, a table, a link reference definition, and the quoted twin above a one-line paragraph all leave the underline a heading and the label under it a definition). paragraphLinesAbove now stops at a block of its own, as the scan's walk always did.
// Imported from the GLM 5.3 Flash hunt cycle 12 of 2026-09-16 (this worktree); all pins flipped green 2026-09-16.
import { describe, expect, it } from "vitest";


import {
	lazyDefinitionLabelNames,
} from "../../src/linting/rules/remove-orphaned-references";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (GLM hunt cycle 12, 2026-09-16): the setext check in
// definitionStartLines counts the paragraph above a setext underline with
// paragraphLinesAbove, which walks back over EVERYTHING that is not blank,
// protected, a definition start, or a depth change. A heading, a thematic
// break, a table, or a link reference definition above the paragraph is a
// BLOCK, not paragraph text: the paragraph above the underline is then
// exactly ONE line long, so Reading view turns it into a setext heading
// (the same one-line rule the cycle-3 Reading-view probes recorded), and a
// footnote label directly under that heading starts a definition.
//
// The scanner's own block walker knows this: oneLineParagraphAbove
// (markdown-scan.ts) breaks its walk at a "#", a rule, a fence, a "<" line,
// or a pipe, which is why an INDENTED chunk after such an underline is
// already pinned as code (cycle 3's underlined-label facts). The label pass
// walks over the block above instead, counts two paragraph lines, judges
// the underline literal text, and the label under it lazy.
//
// What the user sees: Reading view renders the footnote normally, but the
// lazy-definition alert names it ("Obsidian reads as plain text") - a false
// report - and with the fix enabled the lint inserts a blank line the note
// never needed (one per lint-less note; harmless once, but the note is
// changed without cause and the alert is never silent about the wrong
// thing).
//
// Source of truth: CommonMark 4.3 (a setext underline turns the directly
// preceding PARAGRAPH into a heading; a heading, a rule, a fence, a table,
// and a link reference definition are all blocks of their own, so the
// paragraph above the underline is the single line between them) +
// micromark/mdast oracle (all four fixtures parse as
// <block>, heading, footnoteDefinition) + the cycle-3 Reading-view probes
// already recorded in this repo for the one-line rule itself.
//
// Settings involved: `Fix definitions hidden by a missing blank line`
// (default on) and the lazy-definition alert that speaks when it is off.

const fixtures: [string, string][] = [
	["a heading above", "# H\npara\n===\n[^1]: x"],
	["a thematic break above", "---\npara\n===\n[^1]: x"],
	["a table above", "| a | b |\n| - | - |\npara\n===\n[^1]: x"],
	["a link reference definition above", "[ref]: /url\npara\n===\n[^1]: x"],
	["the same inside a quote", "> # H\n> para\n> ===\n> [^1]: x"],
];

describe("a footnote label under a setext underline whose paragraph above is one line", () => {
	for (const [name, doc] of fixtures) {
		it(`starts a definition when ${name} sits above the paragraph`, () => {
			const lines = doc.split("\n");
			const starts = readNote(lines).labelLines;
			expect(starts[starts.length - 1]).toBe(true);
		});

		it(`is not named by the lazy-definition alert when ${name} sits above the paragraph`, () => {
			const lines = doc.split("\n");
			expect(lazyDefinitionLabelNames(lines)).toEqual([]);
			// and the fix inserts nothing
			expect(fixLazyDefinitions(doc)).toBe(doc);
		});
	}
});