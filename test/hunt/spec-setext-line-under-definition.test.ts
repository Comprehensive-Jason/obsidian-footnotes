// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16 (Kimi hunt cycle 3, probed in Reading view): micromark's reading holds under an INDENTED continuation ("x y ===" is one footnote; "---" is a rule). Directly under the label line, or under a LAZY continuation line, a setext underline makes a heading instead (the label's own line dies as heading text; a lazy line is pulled out of the footnote as a heading), pinned in bug-setext-underline-makes-heading.test.ts.
import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION: a setext-shaped line ("===", "--") directly under a
// footnote definition's continuation line - part of the footnote's body,
// or a block that ends it?
//
// micromark (the repo's oracle) parses "[^1]: x", "    y", "===" as ONE
// footnoteDefinition whose paragraph reads "x\ny\n===": the setext-shaped
// line is lazy paragraph-continuation text inside the footnote, exactly
// like "more lazy" (pinned Reading-view ground truth 2026-09-16: a plain
// line directly under a definition joins its body). The plugin's block
// walker EXCLUDES setext-shaped lines from that lazy continuation
// (lazyContinuation in markdown-scan.ts), so the block ends at "y" and
// the "===" is left behind: move-to-bottom moves "[^1]: x\n    y" to the
// bottom and strands the "===", changing the footnote's rendered body
// from "x y ===" to "x y". Orphan deletion likewise cuts the block
// without it.
//
// Why this is a spec question and not a bug pin: Reading view's answer is
// unprobed, and Obsidian has diverged from micromark precisely in this
// neighborhood before (sheet 14: footnote definitions may not interrupt a
// paragraph, where micromark says they may). The pinned shapes nearby all
// cover the OTHER direction - "setext para\n===\n[^103]: after setext h1"
// (a label under a paragraph's setext underline is a definition; the
// plugin agrees) - and none covers a setext-shaped line under a
// DEFINITION's body line. A three-or-more dash line ("---") is a thematic
// break to BOTH parsers (micromark and the plugin agree), so the question
// narrows to "===" runs and one/two-dash runs.
//
// NEEDS A LIVE CHECK: in Reading view, does "[^1]: x", "    y", "===" (or
// "--") render footnote 1's body as "x y ===" (or "x y --"), or as "x y"
// with the setext-shaped line a separate block below?
//
// Source of truth if Reading view agrees with micromark: the move and the
// orphan cut must take the setext-shaped line with the block (the same
// conservation promise as the pinned lazy-line ruling). Settings
// involved: `Move definitions to the bottom` (default ON) and `Delete
// orphaned definitions`.

describe("spec: a setext-shaped line under a definition's continuation", () => {
    it("micromark's reading: \"===\" under \"    y\" is the footnote's lazy body text", () => {
        const lines = "[^1]: x\n    y\n===\n\nuse[^1]".split("\n");
        const blocks = readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }));
        expect(blocks).toEqual([{ name: "1", start: 0, end: 2 }]);
    });

    it("micromark's reading: \"--\" under \"    y\" is the footnote's lazy body text", () => {
        const lines = "[^1]: x\n    y\n--\n\nuse[^1]".split("\n");
        const blocks = readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }));
        expect(blocks).toEqual([{ name: "1", start: 0, end: 2 }]);
    });

    it("control: \"---\" (three dashes) is a thematic break to both parsers - NOT body text", () => {
        const lines = "[^1]: x\n    y\n---\n\nuse[^1]".split("\n");
        const blocks = readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }));
        expect(blocks).toEqual([{ name: "1", start: 0, end: 1 }]);
    });

    it("the move takes the \"===\" body line along (the block already sits at the bottom, so nothing moves)", () => {
        const doc = "para[^1].\n\n[^1]: x\n    y\n===";
        expect(moveFootnoteDefinitionsToBottom(doc, "")).toBe(doc);
    });
});
