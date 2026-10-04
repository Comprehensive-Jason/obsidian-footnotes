// Imported from the glm-cycle-8 hunt of 2026-09-16 (OpenCode worktree); all pins flipped green 2026-09-16 after the fix.
// PROBED 2026-09-16 (GLM hunt cycle 8): Reading view renders "[foo]:" over "/url \"title\"" as a link with its title, and the label under the pair as a definition, so the two-line detection now accepts a title on the destination line.
// Imported from the GLM 5.3 Flash hunt cycle 12 of 2026-09-16 (this worktree); all pins flipped green 2026-09-16.
import { describe, expect, it } from "vitest";


import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION: a link reference definition whose destination line carries
// a title - "[foo]:" then "/url \"title\"".
//
// CommonMark 4.7 lets a link reference definition run over two lines, and
// the title may sit on the DESTINATION's line as well as on its own:
// "[foo]:" with "/url \"title\"" under it is one definition. The repo's
// micromark oracle parses it as definition(foo) + footnoteDefinition for
// the label under the pair. The plugin's two-line detection
// (definitionStartLines, the lrdDestinationNext branch) accepts the
// destination line only when it is a SINGLE token
// (/^\s*\S+\s*$/), so "/url \"title\"" is rejected, "[foo]:" alone reads as
// paragraph text, and the footnote label under the pair is judged LAZY.
//
// Reading view's answer for the BARE destination form is probed (GLM hunt
// cycle 6: Obsidian accepts "[foo]:" then "/url" as a two-line block, and
// the label under the pair is a definition), but the destination-with-
// title form was never probed, so this stays a question rather than a bug
// pin. The plugin already accepts a title on its OWN line (lrdTitle) and a
// title on the one-line form's destination; only the two-line form's
// combined line is missed.
//
// What the user would see if Reading view agrees with CommonMark: the
// footnote under such a pair renders, but the lazy-definition alert names
// it falsely ("Obsidian reads as plain text") and fix-lazy inserts a blank
// line the note never needed.
//
// Source of truth: CommonMark 4.7 (the title may follow the destination on
// the same line) + micromark/mdast. Settings involved: `Fix definitions
// hidden by a missing blank line` and its alert.

describe("spec: a two-line link reference definition whose destination line also carries its title", () => {
	it("lets the footnote label under the pair start a definition, as the bare destination line already does", () => {
		const doc = '[foo]:\n/url "title"\n[^1]: x';
		const lines = doc.split("\n");
		const tree = fromMarkdown(doc, {
			extensions: [gfmFootnote()],
			mdastExtensions: [gfmFootnoteFromMarkdown()],
		});
		// the oracle reads the pair as one definition and the label as a
		// footnote definition
		expect(tree.children.map((node: { type: string }) => node.type)).toEqual([
			"definition",
			"footnoteDefinition",
		]);
		expect(readNote(lines).labelLines).toEqual([
			false,
			false,
			true,
		]);
	});

	it("control: a title on its own line already lets the label start", () => {
		const doc = '[foo]: /url\n"t"\n[^1]: x';
		const lines = doc.split("\n");
		expect(readNote(lines).labelLines).toEqual([
			false,
			false,
			true,
		]);
	});
});