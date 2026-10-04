// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 9 of 9 tests were red there and carry it.fails.
// PROBED 2026-09-16 (GLM hunt cycle 11, Reading view): a PLAIN line directly under a quoted or list-item fence's content is swallowed by the fence (it renders inside the code block), while a blank line, an indented chunk, a heading, a list marker, or a bare fence ends the fence with its container. The fixtures below that put plain text directly under the fence gained the blank line Reading view needs; their purpose (the fence dies with its container) stands.
import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// What a user sees: a fenced code block inside a list item that is never
// closed ("- ```" followed by code) should die where the list item ends.
// Instead the plugin keeps the fence open to the end of the note: every
// line below is treated as code, so autonumbering skips live references,
// "Move footnotes to bottom" refuses the note forever (endsProtected), and
// "Delete orphaned definitions" leaves real orphans in place.
//
// Ground truth: micromark (CommonMark - a fenced code block ends with its
// enclosing container) parses "plain[^1]" below as a live paragraph. The
// plugin already applies this exact rule to fences inside BLOCKQUOTES
// (bug-blockquote-fence-outlives-quote, "a fence lives in the container
// that opened it"), and its fence state records the list item's content
// indent for the closer - but container-DEATH is only tracked for
// blockquote depth, so the fence outlives the list item. One step past the
// container-fence pins: bug-list-item-fence and bug-list-fence-indented-closer
// only cover CLOSED list fences.
//
// NOTE: this contradicts the last test of bug-list-fence-indented-closer
// ("an unclosed list fence still protects to EOF"), which pins the current
// behavior without any ground-truth note. A fix needs to re-ligate that pin.

describe("an unclosed fence inside a list item dies with the item", () => {
    it("the text after an unclosed list fence is live, not code", () => {
        // the blank line after the dead fence belongs to nothing: the item
        // and its fence end on the code line (the note reading, runtime
        // swap step 2, 2026-10-03; the scanner counted the blank as code)
        expect(readNote("- ```\n  code\n\nplain[^1]".split("\n")).protectedLines).toEqual([
            true,
            true,
            false,
            false,
        ]);
    });

    it("a plain line directly under the fence's content is swallowed by the fence", () => {
        // Reading view renders "plain[^1]" inside the code block (GLM hunt
        // cycle 11, probed 2026-09-16), for a bullet's and an ordered
        // item's fence alike; only a blank line, a list marker, a heading,
        // an indented chunk, or a bare fence ends the item's fence
        expect(readNote("- ```\n  code\nplain[^1]".split("\n")).protectedLines).toEqual([true, true, true]);
        expect(readNote("1. ```\n   code\nplain[^1]".split("\n")).protectedLines).toEqual([true, true, true]);
        expect(computeNextFootnoteNumber("- ```\n  code[^99]\nplain[^1]")).toBe(1);
    });

    it("a reference after the dead fence counts in autonumbering", () => {
        expect(computeNextFootnoteNumber("- ```\n  code[^99]\n\nplain[^1]")).toBe(2);
    });

    it("the next list item ends the fence", () => {
        expect(computeNextFootnoteNumber("- ```\n  code[^99]\n- item[^1]")).toBe(2);
    });

    it("an ordered item's fence dies the same way", () => {
        expect(readNote("1. ```\n   code\n\nplain[^1]".split("\n")).protectedLines).toEqual([
            true,
            true,
            false,
            false,
        ]);
    });

    it("a nested bullet's fence dies at document level too", () => {
        // the pinned closed shape is "- outer\n  - ```\n    fake[^1]\n    ```";
        // unclosed, the fence must die where the nested item ends
        expect(
            readNote("- outer\n  - ```\n    code\n\nplain[^1]".split("\n")).protectedLines,
        ).toEqual([false, true, true, false, false]);
    });

    it("the pinned EOF-swallow shape itself (re-litigation)", () => {
        // the existing pin expects [true,true,true,true] + endsProtected;
        // micromark reads "swallowed" as a live paragraph
        const reading = readNote("10. ```\n    code\n\nswallowed".split("\n"));
        expect(reading.protectedLines).toEqual([true, true, false, false]);
        expect(reading.openRegionFrom !== -1).toBe(false);
    });

    it("a bare fence line after a list fence opens a NEW fence instead of closing", () => {
        // micromark: the list fence dies with its item, so the bare "```"
        // OPENS a new unclosed fence at the document level and "real[^1]"
        // is code. The plugin lets the bare line close the list fence
        // (depth 0 matches, and 0 <= contentIndent + 3), so "real[^1]"
        // comes out live. Same missing list arm, protection inverted:
        // code the user sees as code gets numbered and linted.
        expect(computeNextFootnoteNumber("- ```\n  code[^9]\n```\nreal[^1]")).toBe(1);
        expect(readNote("- ```\n  code[^9]\n```\nreal[^1]".split("\n")).protectedLines).toEqual([
            true,
            true,
            true,
            true,
        ]);
    });

    it("move-to-bottom is not refused below a dead list fence", () => {
        const doc = "- ```\n  code\npara[^1]\n\n[^1]: def\n\ntail";
        expect(moveFootnoteDefinitionsToBottom(doc)).toBe(
            "- ```\n  code\npara[^1]\n\ntail\n\n[^1]: def",
        );
    });

    it("drop-orphans deletes a real orphan below a dead list fence", () => {
        const doc = "- ```\n  code\n\nreal[^1]\n\n[^1]: def\n\n[^9]: stray";
        expect(reindexFootnotes(doc, { keepOrphanedDefinitions: false })).toBe(
            "- ```\n  code\n\nreal[^1]\n\n[^1]: def",
        );
    });
});
