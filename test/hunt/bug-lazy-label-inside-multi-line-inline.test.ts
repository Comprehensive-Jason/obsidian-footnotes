import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): a label-shaped line inside an inline footnote that
// runs over two lines is taken for a lazy label, and the default lint cuts
// the inline footnote in two.
//
// What the user would see: "Text[^1] and^[inline" / "[^9]: not a def]
// end." is linted on save into "Text[^1] and^[inline", a blank line, and
// the rest of the sentence moved to the bottom as a new footnote [^2]: the
// inline footnote is broken and part of the sentence leaves the paragraph.
//
// Hunt 2026-10-05, round 1, lens regressions. Cluster RG1 (a harder variant
// of the Kimi cycle 1 exclusion of labels inside a "%%" comment).
//
// Source of truth: rule E3 in docs/obsidian-reading-rules.md (references,
// labels, and nested inline footnotes inside an inline footnote are dead
// text); Obsidian's answer probe:e3-lines ("a^[x\n[^1] y] w[^2]" reads
// [^1] as dead); the plugin's own reader agrees (control below); the
// inline-comment precedent (1928ad3: a label in dead text is never lazy and
// never given a blank line).
//
// Cause: labelShapedLines in src/parsing/label-shapes.ts skips protected
// lines and comments but never asks whether the label sits inside an
// inline footnote, and fix-lazy's trial guard only checks protected text.
//
// The second test is the same root through an inline HTML tag whose quoted
// attribute value runs over the line break (remark-parse 8's inline HTML
// allows it, and the plugin's reader reads no [^9] there). Whether Obsidian
// reads such a tag the same way is not yet checked against the live app
// (Cluster RG2); if it does not, that test is a probe error to drop.

const DEFAULT_LINT: LintOptions = {
    fixPunctuation: true,
    placement: "after",
    fixLazyDefinitions: true,
    moveDefinitionsToBottom: true,
    reindex: true,
};

const INLINE_NOTE = ["Text[^1] and^[inline", "[^9]: not a def] end.", "", "[^1]: one", ""].join("\n");
const INLINE_TAG = ['a <span title="x', '[^9]: y">z</span> b[^1].', "", "[^1]: one", ""].join("\n");

describe("a label-shaped line inside an inline construct running over two lines", () => {
    it("control: the reader reads the inline footnote's [^9] as dead (rule E3)", () => {
        const reading = readNote(INLINE_NOTE.split("\n"));
        expect(reading.definitions.map((d) => d.name)).toEqual(["1"]);
        expect(reading.references.filter((r) => r.live).map((r) => r.name)).toEqual(["1"]);
    });

    it.fails("fix-lazy leaves a label inside a multi-line inline footnote alone", () => {
        expect(fixLazyDefinitions(INLINE_NOTE)).toBe(INLINE_NOTE);
    });

    it.fails("the default lint keeps the inline footnote whole", () => {
        // today: "Text[^1] and^[inline\n\n[^1]: one\n[^2]: not a def] end.\n"
        expect(lintFootnotes(INLINE_NOTE, DEFAULT_LINT)).toContain("and^[inline\n[^9]: not a def] end.");
    });

    it.fails("the default lint keeps a multi-line inline HTML tag whole (needs a live check, RG2)", () => {
        // today: 'a <span title="x\n\n[^1]: one\n[^2]: y">z</span> b.[^1]\n'
        expect(lintFootnotes(INLINE_TAG, DEFAULT_LINT)).toContain('<span title="x\n[^9]: y">z</span>');
    });
});
