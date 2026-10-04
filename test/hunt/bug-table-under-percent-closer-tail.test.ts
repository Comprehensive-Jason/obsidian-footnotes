// Imported from the GLM 5.3 Flash cycle 3 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";


import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// The visible tail after an Obsidian "%%" BLOCK comment's closer is live
// paragraph text (sheet 11: "%% [^3]: def" renders as a definition, and
// the reading's own definitionStartLines reads a closer line with a tail as
// `open = "paragraph"`). A GFM table cannot start directly under a line
// of paragraph text (pinned in Reading view, cycle 3: "a table header
// directly under plain paragraph text ... is no table at all"), so the
// header row under "%% tail" is ordinary paragraph text too.
//
// tableRowLinesOf's paragraphTextAbove guard disagrees with all of that:
// its plainText test treats any line whose only "%%" is at the content
// start as "not paragraph text" (the branch exists for the block OPENER
// and for the bare closer, which both stand at a block boundary). On the
// closer-with-tail line it fires wrongly, so the run under the tail is
// detected as a TABLE.
//
// Downstream, definitionStartLines believes a label under that run ends a
// table and therefore starts a definition, and lazyDefinitionLabelNames
// then exempts it from the lazy-definition alert. Reading view renders
// the whole run - pipes and label alike - as one paragraph, so with the
// gather rule off the user's "[^1]: def" sits there as plain text and no
// alert ever names it: a silent miss of exactly the shape the
// lazy-definition alert exists for (former sheet 23), against the never-silent
// policy (ADR 0002).
//
// What the user sees: they typed a definition one blank line short below
// a comment block's "%% tail" line; the lint neither fixes nor reports
// it, and reindex numbers a "definition" Obsidian shows as prose.
//
// Source of truth: sheet 11 (the tail after a closer is live) + the
// cycle-3 Reading-view probe (no table under a paragraph line) + the
// reading's own paragraph reading of the tail line.
//
// Settings involved: `Move definitions to the bottom` off (with it on,
// the gather accidentally heals the label); `Fix definitions hidden by a
// missing blank line` on or off - both the fix and the alert miss.

const scanOf = (doc: string) => {
    const lines = doc.split("\n");
    const reading = readNote(lines);
    const masked = [...readNote(lines).maskedLines()];
    return { lines, reading, masked, starts: readNote(lines).labelLines };
};

describe("a table run under a %% block closer's tail line", () => {
    it("is no table: the tail is paragraph text and a table cannot interrupt it", () => {
        const lines = "%%\nhidden\n%% tail\n| a | b |\n| --- | --- |\n| c | d |".split("\n");
        expect(readNote(lines).tableRowLines).toEqual([false, false, false, false, false, false]);
    });

    it("a label under the run is lazy paragraph text, not a definition start", () => {
        const { starts } = scanOf("%%\nhidden\n%% tail\n| a | b |\n| --- | --- |\n[^1]: def\n\nuse[^1]");
        expect(starts[5]).toBe(false);
    });

    it("the lazy-definition alert names the label the run hides", () => {
        const { lines } = scanOf("%%\nhidden\n%% tail\n| a | b |\n| --- | --- |\n[^1]: def\n\nuse[^1]");
        expect(lazyDefinitionLabelNames(lines)).toEqual(["1"]);
    });

    it("control: under the bare closer (a block boundary) the table does start", () => {
        const lines = "%%\nhidden\n%%\n| a | b |\n| --- | --- |".split("\n");
        expect(readNote(lines).tableRowLines).toEqual([false, false, false, true, true]);
    });

    it("control: under the inline pair (a comment-only paragraph line) there is no table", () => {
        const lines = "%% c %%\n| a | b |\n| --- | --- |".split("\n");
        expect(readNote(lines).tableRowLines).toEqual([false, false, false]);
    });
});
