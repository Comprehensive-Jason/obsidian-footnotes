// Imported from the glm-cycle-8 hunt of 2026-09-16 (OpenCode worktree); all pins flipped green 2026-09-16 after the fix.
// RESOLVED 2026-09-16 (GLM hunt cycle 8, both shapes probed in Reading view: the indented chunk under the setext heading is a code block after a link reference definition and after a "%%" block's bare closer). oneLineParagraphAbove now stops at both.
// Imported from the GLM 5.3 Flash hunt cycle 12 of 2026-09-16 (this worktree); all pins flipped green 2026-09-16.
import { describe, expect, it } from "vitest";

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { readNote } from "../../src/parsing/note-reading";


// BUG (GLM hunt cycle 12, 2026-09-16), the scan half of the bug pinned in
// bug-setext-paragraph-count-ignores-blocks.test.ts: oneLineParagraphAbove
// (markdown-scan.ts), the walk that decides whether a setext underline turns
// the paragraph above it into a heading, counts lines back until a blank
// line, a protected line, a depth change, or a definition-start label. It
// does NOT stop at a link reference definition, or at a "%%" block comment's
// bare closer, although both end their block and are NOT paragraph text.
//
// The paragraph walk that the SAME scan uses for cross-line code spans and
// regions (paragraphGoesOn, and oneLineParagraphAbove's own regex list)
// stops at both: a link reference definition is a block of its own (pinned
// in cycle 5), and a bare "%%" closer ends its block (sheet 11: a label
// directly under a bare closer is a definition, so the closer is a block
// boundary and not paragraph text). So the two walks in one file disagree,
// and the indented chunk after the setext heading reads LIVE when Reading
// view renders it as code.
//
// What the user would see: "    code[^7]" under such an underline holds a
// reference-shaped string that Reading view shows as plain code text, but
// the plugin counts it live, so reindex hands its number out to it, the
// punctuation rule moves it, orphan handling judges it, and move-to-bottom
// can gather definitions around it - protected text rewritten, the promise
// the linter makes broken (docs/adr/0002's conservation spirit, former sheet 20
// section I records the indented-chunk-under-a-heading shape).
//
// Source of truth: CommonMark 4.3 (a setext underline heads the directly
// preceding paragraph, and "[ref]: /url" is a block of its own, so that
// paragraph is the single line between) + micromark/mdast (definition,
// heading) + the cycle-5 Reading-view pin that an indented chunk after a
// setext heading is code + sheet 11's %% block facts (a bare closer ends
// the block). Control in the same file: the label-line variant
// ("[^1]: body", "para", "===") where the recorded Reading-view fact
// (the lazy line is pulled out as a heading) already makes the chunk code,
// and the scan agrees today.
//
// Settings involved: none (pure scanner); every rule that reads protection
// inherits it.

const scanProtected = (doc: string) => readNote(doc.split("\n")).protectedLines;

describe("an indented chunk under a setext heading whose paragraph is one line", () => {
	it("is indented code after a link reference definition, as after any heading", () => {
		const doc = "[ref]: /url\npara\n===\n    code[^7]";
		const tree = fromMarkdown("[ref]: /url\npara\n===\nx", {
			extensions: [gfmFootnote()],
			mdastExtensions: [gfmFootnoteFromMarkdown()],
		});
		// the oracle agrees on the structure: a definition, then the setext
		// heading, then the indented line outside it
		expect(tree.children.map((node: { type: string }) => node.type).slice(0, 2)).toEqual([
			"definition",
			"heading",
		]);
		expect(scanProtected(doc)).toEqual([false, false, false, true]);
	});

	it("is code under a setext heading after a %% block's bare closer too", () => {
		const doc = "%%\nhidden\n%%\npara\n===\n    code[^7]";
		expect(scanProtected(doc)).toEqual([
			false,
			false,
			false,
			false,
			false,
			true,
		]);
	});

	it("control: the same shape under a real definition's lazy line is already code", () => {
		const doc = "[^1]: body\npara\n===\n    code[^7]";
		expect(scanProtected(doc)).toEqual([false, false, false, true]);
		// and the scan agrees without the indented line, so the divergence is
		// the line counting above the underline, not the chunk rule
		expect(readNote("[ref]: /url\npara\n===".split("\n")).protectedLines).toEqual([
			false,
			false,
			false,
		]);
	});
});