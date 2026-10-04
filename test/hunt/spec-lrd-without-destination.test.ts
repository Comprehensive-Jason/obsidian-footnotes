// Imported from the GLM 5.3 Flash cycle 5 hunt of 2026-09-16 (OpenCode worktree); 1 of 2 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16 (GLM hunt cycle 5, probed in Reading view): "[foo]:" alone renders as paragraph text and the label under it is lazy; a link reference definition needs a destination on its line to count as a block.
// GLM 5.3 Flash cycle 9 hunt of 2026-09-16 (this worktree); the red test carries it.fails.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION: does Reading view read "[foo]:" alone on a line (a link
// reference definition with NO destination) as a link reference definition
// block, or as plain paragraph text?
//
// CommonMark needs a destination: "[foo]:" alone is not a definition, and
// micromark renders "<p>[foo]:</p>" (probed for this hunt). If Obsidian
// agrees, the label under it is one blank line short of nothing: it sits
// directly under a PARAGRAPH line, and the probed prose-label rule (sheet
// 25) makes it lazy paragraph text - "[^1]: def" renders as plain text.
//
// The plugin's LRD branch (definitionStartLines, the
// LinkReferenceDefinition pattern) accepts "[foo]:" as a block of its own
// because the pattern only asks for "]" then ":" then whitespace-or-end;
// a label under it then STARTS a definition. The rules treat the note as
// holding a real footnote that Obsidian (on the CommonMark reading) shows
// as prose: move-to-bottom gathers it, reindex numbers it, the
// lazy-definition alert never fires, and with Delete orphaned definitions
// ON the "definition" (that never rendered) is deleted once the reference
// goes.
//
// The cycle 1 probe this extends: "a label under a link reference
// definition ... is a definition" was probed with a REAL definition
// ("[foo]: /url", destination present). The destination-less line was
// never probed.
//
// NEEDS A LIVE CHECK: does "[foo]:\n[^1]: def" render a footnote entry in
// Reading view, or is "[^1]: def" plain text under the "[foo]:" paragraph?
//
// Source of truth: CommonMark 4.7 (a link reference definition needs a
// destination) via micromark; Obsidian unprobed.
// Settings involved: none directly (the scan feeds every rule).

function startsOf(doc: string): number[] {
    const lines = doc.split("\n");
    return readNote(lines).labelLines
        .map((s, i) => (s ? i : -1))
        .filter((i) => i >= 0);
}

describe("spec: a link reference definition without a destination", () => {
    it("the label under the destination-less line is lazy paragraph text", () => {
        const doc = "[foo]:\n[^1]: def\ntext[^1] ref";
        expect(startsOf(doc)).toEqual([]);
    });

    it("control: with a destination present, the label under it is a definition (cycle 1)", () => {
        const doc = "[foo]: /url\n[^1]: def\ntext[^1] ref";
        expect(startsOf(doc)).toEqual([1]);
    });
});
