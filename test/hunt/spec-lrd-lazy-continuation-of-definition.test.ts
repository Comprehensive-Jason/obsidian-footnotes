// Imported from the GLM 5.3 Flash cycle 6 hunt of 2026-09-16 (OpenCode worktree); 2 of 2 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// REFUTED 2026-09-16 (GLM hunt cycle 6, probed in Reading view): footnote 1 renders as "body", the link reference definition works, and "more" is a paragraph of its own, so the LRD line ends the definition, as the walker reads it.
import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION (GLM hunt, cycle after 9, 2026-09-16): a column-0 link
// reference definition line ("[foo]: /url") directly under a footnote
// definition - body text of that footnote, or a block that ends it?
//
// micromark (the repo's oracle) parses "[^1]: body\n[foo]: /url\nmore"
// as ONE footnoteDefinition whose paragraph reads "body\n[foo]: /url\n
// more": the LRD line lazy-continues the footnote's paragraph, exactly
// like "more". The plugin's block walker EXCLUDES an LRD line from the
// lazy continuation (lazyContinuation in markdown-scan.ts - it carries
// the same interrupter list the paragraph walk knows), so the block ends
// after "body" and the "[foo]: /url" line is stranded. Move-to-bottom
// moves "[^1]: body" alone and leaves the LRD line behind; orphan
// deletion cuts the block without it, and the stranded line then sits at
// a boundary where it reads as a hidden LRD - the footnote's rendered
// body changes from "body [foo]: /url" to "body".
//
// Why this is a spec question and not a bug pin: Reading view's answer is
// unprobed, and Obsidian has diverged from micromark exactly in this
// neighborhood before (sheet 14: a footnote definition may not interrupt
// a paragraph; "  [^1]: x" directly under another definition starts a
// NEW footnote, where micromark reads it as a continuation). The pinned
// lazy-continuation shapes nearby (cycle 9, probed) cover "2. item text",
// a fence with a backtick in its info, "<3", a comment-only "%% c %%"
// line, and an inline <span> - none covers an LRD line under a
// definition's body.
//
// NEEDS A LIVE CHECK: in Reading view, does "[^1]: body", "[foo]: /url"
// render footnote 1's body as "body [foo]: /url", or does the LRD line
// end the footnote and hide as a link reference definition below it?
//
// Source of truth if Reading view agrees with micromark: the block walk,
// the move, and the orphan cut must take the LRD line with the block
// (definitionStartLines' lrdAbove state and the label-under-LRD ruling
// already treat the ONE-line LRD as a block, so the two would also have
// to agree on where that block sits).
//
// Settings involved: `Fix definitions hidden by a missing blank line`
// (the scan's answer drives the alert), plus the default move-to-bottom
// and the orphan rules.

const doc = "[^1]: body\n[foo]: /url\nmore\n\nuse[^1]";

describe("spec: does a column-0 link reference definition line lazily continue a definition?", () => {
    it("REFUTED: the link reference definition ends the footnote, so the block is the label line alone", () => {
        const lines = doc.split("\n");
        expect(readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([
            expect.objectContaining({ name: "1", start: 0, end: 0 }),
        ]);
    });

    it("REFUTED: move-to-bottom leaves the link reference definition and the paragraph under it in place", () => {
        expect(moveFootnoteDefinitionsToBottom(doc)).toContain("[foo]: /url\nmore");
    });
});
