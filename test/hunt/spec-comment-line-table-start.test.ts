// Imported from the Kimi K3 cycle 4 hunt of 2026-09-16 (OpenCode worktree); 1 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16 (Kimi hunt cycle 4, probed in Reading view): the run renders as a paragraph with literal pipes and the label under it is lazy, so a comment-only line is paragraph text for tables as well; tableRowLinesOf now treats only a lone "%%" (a block opener) as a boundary.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// spec question: can a GFM table start directly under an Obsidian
// comment-only line ("%% c %%")?
//
// The plugin disagrees with ITSELF here. definitionStartLines treats a
// comment-only line as a paragraph line, per sheet 11's recorded Reading
// view check ("a comment-only line is still a paragraph line"): a label
// under one is lazy. tableRowLinesOf treats the same line as a BLOCK
// boundary: its paragraphTextAbove check excludes lines starting with
// "%%", so a table header directly under a comment-only line counts as a
// table, and a label under the delimiter row then counts as a definition.
// One of the two readings must be wrong: a table cannot interrupt a
// paragraph (GFM), so if the comment line is a paragraph line the table
// is no table and the label is lazy.
//
// The catch: Obsidian HIDES the comment, so its table detection may run
// on text that no longer has the comment line in it, in which case the
// table stands. What Reading view does with
// "%% c %%\n| a | b |\n| --- | --- |\n[^1]: x" is not recorded anywhere.
//
// NEEDS A LIVE CHECK: if Reading view shows a table, the plugin is
// consistent after all and definitionStartLines' comment-line rule is the
// one to revisit; if it shows a paragraph with literal pipes,
// tableRowLinesOf's paragraphTextAbove is too eager and the label is
// lazy.
//
// Source of truth: GFM's "a table cannot interrupt a paragraph" plus
// sheet 11's recorded ruling that a comment-only line is a paragraph
// line. The two plugin readers cannot both be right.

describe("spec question: a table header directly under a %% comment-only line", () => {
    const doc = "%% c %%\n| a | b |\n| --- | --- |\n[^1]: x";

    it("the table reader no longer allows the table (Reading view: literal pipes)", () => {
        expect(readNote(doc.split("\n")).tableRowLines[1]).toBe(false);
    });

    it("the definition reader agrees: the label under the run is lazy", () => {
        const lines = doc.split("\n");
        const starts = readNote(lines).labelLines;
        expect(starts[3]).toBe(false);
    });

    it("if the comment line is a paragraph line for tables too, the run is no table and the label is lazy", () => {
        expect(readNote(doc.split("\n")).tableRowLines[1]).toBe(false);
        const lines = doc.split("\n");
        const starts = readNote(lines).labelLines;
        expect(starts[3]).toBe(false);
    });
});
