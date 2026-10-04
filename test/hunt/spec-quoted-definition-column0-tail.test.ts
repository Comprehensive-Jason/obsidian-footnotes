// Imported from the glm-cycle-9 hunt of 2026-09-16 (OpenCode worktree); rewritten to the probed reading 2026-09-16.
// REFUTED 2026-09-16 (GLM hunt cycle 9, probed in Reading view): a plain column-0 line directly under a quoted definition is the quoted footnote's lazy body ("quoted def plain column-0 line"), further plain lines carry it on, a label under them starts a new definition, a heading ends the run, and an indented chunk after the tail is code. definitionStartLines was right; quotedDefinitionEnd now owns the tail, the reading protects the chunk, and the press guard reaches the tail.
// Imported from the GLM 5.3 Flash cycle 13 hunt of 2026-09-16 (OpenCode worktree); 1 of 3 tests carries it.fails: marked by this hunt.
import { readNote } from "../../src/parsing/note-reading";
import { describe, expect, it } from "vitest";

import { definitionLabelWithName } from "../../src/parsing/label-shapes";

import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// SPEC QUESTION: does a column-0 plain line after a quoted definition line
// lazily continue the quote's definition, or start a fresh paragraph
// outside the quote?
//
//     > [^1]: quoted def
//     plain column-0 line
//     [^2]: second
//
// The plugin answers this question in TWO OPPOSITE WAYS, and one of them
// must be wrong about Obsidian:
//
// - definitionStartLines carries its "definition" state across the
//   column-0 line (the lazyContinuation branch: "A plain line directly
//   under a definition is the definition's own lazy continuation"), so
//   "[^2]: second" reads as a DEFINITION start.
// - quotedDefinitionEnd stops the quoted definition at its own label line
//   ("each following non-blank quoted line at the same depth ... a change
//   of quote depth end it"), so the column-0 line is NOT part of the
//   quoted definition. Under sheet 14's prose-label rule, a label directly
//   under a plain paragraph line is then LAZY text.
//
// If Obsidian reads the column-0 line as a new paragraph outside the quote
// (what quotedDefinitionEnd's recorded Reading-view extent implies), the
// consequences today are: "[^2]: second" is gathered as a definition and,
// with `Delete orphaned definitions` ON, a line Obsidian renders as prose
// is CUT; the lazy-definition alert never names it. If instead the
// column-0 line lazily continues the quote's definition inside the quote
// (CommonMark's lazy continuation through a container), then
// quotedDefinitionEnd is the reader that is wrong, and orphan deletion of
// a quoted label would strand its column-0 lazy body.
//
// NEEDS A LIVE CHECK: in Reading view, does "> [^1]: quoted def" then
// "plain column-0 line" then "[^2]: second" render "[^2]: second" as a
// footnote entry at the bottom (definition), or as plain text with no
// entry (lazy), or folded into footnote 1's body (lazy continuation of the
// quote's definition)?
//
// Source of truth: manual sheet 14 (the prose-label rule) + the
// quotedDefinitionEnd contract recorded as verified in Reading view
// 2026-09-16; Obsidian unprobed for this exact adjacency.
//
// Settings involved: `Delete orphaned definitions` (the prose line is cut),
// `Fix definitions hidden by a missing blank line` (never offered).

const doc = [
    "> [^1]: quoted def",
    "plain column-0 line",
    "[^2]: second",
    "",
    "tail",
].join("\n");

const ctxOf = (markdown: string) => {
    const lines = markdown.split("\n");
    const reading = readNote(lines);
    const masked = [...readNote(lines).maskedLines()];
    const starts = readNote(lines).labelLines;
    return { lines, reading, masked, starts };
};

describe("a label under a column-0 line that follows a quoted definition", () => {
    it("REFUTED: the label starts a definition, since the column-0 line is the quoted footnote's lazy body", () => {
        // Reading view (probed 2026-09-16): one footnote "quoted def plain
        // column-0 line", then footnote "second"; the lazy-definition
        // alert has nothing to name
        const { lines, starts } = ctxOf(doc);
        expect(starts[2]).toBe(true);
        expect(lazyDefinitionLabelNames(lines)).toEqual([]);
        // the label follows lazy lines of the quote, so the note reading
        // puts footnote 2 inside the quote too: a definition, but not a
        // block that moves (Jason's ruling 1, option a, 2026-10-03)
        expect(readNote(lines).blocks.map((b) => b.start)).toEqual([]);
    });

    it("the orphan rules' reader owns the column-0 tail, so the whole footnote is cut together", () => {
        const { lines, masked, starts } = ctxOf(doc);
        expect(starts[0]).toBe(true);
        expect((readNote(lines).labelOn(0)?.end ?? 0)).toBe(1);
        const hit = definitionLabelWithName(lines[0], masked[0]);
        expect(hit?.name).toBe("1");
        // the quoted label's own "[^1]" is not a reference
        expect(readNote(lines).referencesOn(0)).toEqual([]);
        // an orphaned quoted definition takes its column-0 tail with it
        // instead of stranding the footnote's body as prose
        expect(removeOrphanedFootnoteDefinitions("> [^1]: quoted def\nplain column-0 line\n\ntail")).toBe("tail");
    });

    it("the tail runs through further plain lines, stops at a heading, and takes no indented chunk", () => {
        const two = ctxOf("> [^1]: quoted def\nplain one\nplain two\n\ntail[^1]");
        expect((readNote(two.lines).labelOn(0)?.end ?? 0)).toBe(2);
        const heading = ctxOf("> [^1]: quoted def\nplain one\n# H\n\ntail[^1]");
        expect((readNote(heading.lines).labelOn(0)?.end ?? 0)).toBe(1);
        // an indented chunk after the column-0 tail is code (Reading view
        // lets no indented line continue a quote's paragraph), with or
        // without a blank line before it
        const chunk = ctxOf("> [^1]: quoted def\nplain column-0 line\n    chunk[^9]\n\ntail[^1]");
        expect(chunk.reading.protectedLines).toEqual([false, false, true, false, false]);
        expect((readNote(chunk.lines).labelOn(0)?.end ?? 0)).toBe(1);
        const gap = ctxOf("> [^1]: quoted def\nplain column-0 line\n\n    chunk[^9]\n\ntail[^1]");
        expect(gap.reading.protectedLines).toEqual([false, false, false, true, false, false]);
        // and a quoted lazy line before the column-0 one is part of the run
        const mixed = ctxOf("> [^1]: quoted def\n> quoted lazy\nplain column-0 line\n[^2]: second\n\ntail[^1] and[^2]");
        expect((readNote(mixed.lines).labelOn(0)?.end ?? 0)).toBe(2);
        expect(mixed.starts[3]).toBe(true);
    });
});
