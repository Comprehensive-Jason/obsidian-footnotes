// Imported from the glm-cycle-8 hunt of 2026-09-16 (OpenCode worktree); all pins flipped green 2026-09-16 after the fix.
// RESOLVED 2026-09-16 (GLM hunt cycle 8, all shapes probed in Reading view: "lazy" is pulled out as a heading and the label under the underline is a definition; "x y ===" is one footnote, the label under it starts the next, and an indented chunk after the underline, with or without a blank gap, is the footnote's live body). definitionStartLines reads an underline under a definition by the line above it, and the reading's one-line walk treats an underline under indented continuation as body text.
// Imported from the GLM 5.3 Flash hunt cycle 12 of 2026-09-16 (this worktree); all pins flipped green 2026-09-16.
import { describe, expect, it } from "vitest";


import {
	lazyDefinitionLabelNames,
} from "../../src/linting/rules/remove-orphaned-references";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (GLM hunt cycle 12, 2026-09-16): the recorded Reading-view facts for a
// setext underline directly under a DEFINITION's own paragraph (Kimi hunt
// cycle 3, probed; test/hunt/bug-setext-underline-makes-heading.test.ts and
// the resolved spec-setext-line-under-definition.test.ts) are:
//
//   "[^1]: x", "lazy", "==="    footnote "x"; "lazy" is pulled out as a
//                               heading, so the block ends at the label
//   "[^1]: x", "    y", "==="   ONE footnote reading "x y ===" - the
//                               underline is the footnote's body text
//
// The block walker (findDefinitionBlocks) implements both: it ends the
// block before a lazy line the underline pulls out, and it owns an
// underline under an INDENTED continuation as body text (the
// setext-under-indented check). Two other walks in the same file do not:
//
//   - definitionStartLines only recognises a setext underline when its
//     paragraph state is "paragraph". Under a definition (open ===
//     "definition"), the underline falls through to `open = "paragraph"`,
//     so the footnote label under it is judged LAZY in both shapes - when
//     Reading view renders it as a definition (under the pulled-out
//     heading in the lazy shape; under the definition's body in the
//     indented shape, since a label directly under a definition starts
//     one). The lazy-definition alert then names it falsely, and
//     fix-lazy inserts a blank line the note never needed.
//
//   - scanDocument's block ender uses oneLineParagraphAbove, whose walk
//     breaks at a definition-start label and counts the INDENTED
//     continuation as the one paragraph line, so it heading-ifies the
//     "===" in the indented shape: the definition state closes and the
//     indented line after it is protected as indented CODE. Reading view
//     reads that line as the footnote's live body (its reference binds,
//     renders, and can be renamed), so a reference-shaped string in it
//     flips live/dead between the plugin's two walks - findDefinitionBlocks
//     absorbs the very line the reading protects.
//
// What the user sees: with the fix toggle off, a false "Obsidian reads as
// plain text" alert on every lint for a footnote that renders; with it on,
// a blank line inserted the note never needed; and in the indented shape,
// a reference inside the footnote's own body that no rule will renumber,
// move, or count, because the reading declared it code.
//
// Source of truth: the two Reading-view probes recorded above (2026-09-16)
// plus CommonMark 4.3 (the underline heads the directly preceding
// paragraph, and an indented line cannot start a new block under an open
// container paragraph) + micromark/mdast, which parses both label fixtures
// as two footnoteDefinitions and keeps the "===" inside the first one.
//
// Settings involved: `Fix definitions hidden by a missing blank line`
// (default on) and the lazy-definition alert that speaks when it is off.

const scanFacts = (doc: string) => {
	const lines = doc.split("\n");
	const reading = readNote(lines);
	const masked = [...readNote(lines).maskedLines()];
	return { lines, reading, masked, starts: readNote(lines).labelLines };
};

describe("a footnote label directly under a setext underline that sits under the definition's own paragraph", () => {
	it("starts a definition when the underline pulled the definition's lazy line out as a heading", () => {
		const { starts } = scanFacts("[^1]: body\nlazy\n===\n[^2]: x");
		// Reading view: "lazy" is a heading, so "[^2]: x" under it starts
		expect(starts).toEqual([true, false, false, true]);
	});

	it("starts a definition when the underline is the footnote's body text (indented continuation)", () => {
		const { starts } = scanFacts("[^1]: x\n    y\n===\n[^2]: z");
		// Reading view: "x y ===" is one footnote, and a label directly
		// under it starts the next one
		expect(starts).toEqual([true, false, false, true]);
	});

	it("is not named by the lazy-definition alert in the indented shape", () => {
		const doc = "[^1]: x\n    y\n===\n[^2]: z";
		const { lines } = scanFacts(doc);
		expect(lazyDefinitionLabelNames(lines)).toEqual([]);
		expect(fixLazyDefinitions(doc)).toBe(doc);
	});
});

describe("the reading's own definition state after a setext underline that is the footnote's body text", () => {
	it("keeps the indented chunk after it live, as the block walker already reads it", () => {
		const { lines, reading } = scanFacts("[^1]: x\n    y\n===\n    z[^9]");
		// the block walker owns both the "===" and the line under it
		// (the resolved spec question: "x y ===" is one footnote)
		expect(reading.protectedLines[3]).toBe(false);
		expect(reading.protectedLines).toEqual([false, false, false, false]);
		void lines;
	});

	it("keeps it live across the blank gap too, like any definition's content", () => {
		const doc = "[^1]: x\n    y\n===\n\n    z[^9]";
		const { reading } = scanFacts(doc);
		expect(reading.protectedLines).toEqual([false, false, false, false, false]);
	});

	it("control: the lazy-continuation face already closes the reading's own state", () => {
		// Reading view pulls "lazy" out as a heading, so the chunk after the
		// underline is code, and the reading agrees today
		const doc = "[^1]: body\nlazy\n===\n    z[^9]";
		expect(scanFacts(doc).reading.protectedLines).toEqual([
			false,
			false,
			false,
			true,
		]);
	});
});