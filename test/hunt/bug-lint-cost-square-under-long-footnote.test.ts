// BUG (annoyance): the lint slows down with the square of the number of
// footnotes packed under a very long first footnote.
//
// What the user would see: a note citing n sources, the definitions packed
// one per line as the plugin writes them, and footnote 1 grown to about 170
// words (past Obsidian's 1,024-character look-ahead, rule E4). Each lint
// reads the note about n x n times: about 0.35 s at 30 footnotes, 1.5 s at
// 50, 3 s at 100, and 28 s at 200, where 34d5377 read it 3 times. The
// output is unchanged.
//
// Hunt 2026-10-09, cycle 8. Cluster V14, lens the lint.
// Source of truth: the hunt's relative-cost rule (count readings, not wall
// clock), with 34d5377 as the baseline; the Y7 shape was ruled in scope in
// cycle 7.
// Origin: regression from d9b6156 (cycle 7's Y7 fix: label-shapes.ts reads
// the whole note once per label-shaped line inside a footnote, and fix-lazy
// asks again for each label it tries); green at 34d5377, red at 3a47f7a.

// Hunt cycle 8 (the lint), lead 6: the cost of besideWithBlankAbove
// (d9b6156, Y7). A note whose first footnote runs past Obsidian's
// 1,024-character look-ahead (docs/obsidian-reading-rules.md E4, about 170
// words) with more footnotes packed under it, as the user wrote them
// before the first one grew: Obsidian reads every later label as more text
// of the long footnote. labelShapedLines now reads the whole note once for
// each of those labels, and fix-lazy asks for the list again for every
// label it tries, so one lint reads the note a number of times that grows
// with the square of the footnotes. At 34d5377 the same lint read it 3
// times; at 50 footnotes it now reads it about 1,400 times (1.5 s on
// sprout), at 200 about 20,700 times (28 s). Measured in readings built
// (parseCount), not wall clock.
import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { parseCount } from "../../src/parsing/note-reading";

/** `n` footnotes after a first one of about 1,250 characters, packed one per line, each cited in its own paragraph. */
function longFirstPacked(n: number, long = true): string {
    const body: string[] = [];
    for (let i = 1; i <= n + 1; i++) body.push(`Paragraph ${i} cites a source[^${i}].`, "");
    const first = long ? "Lorem ipsum dolor sit amet, consectetur adipiscing. ".repeat(24) : "Short source.";
    const defs = [`[^1]: ${first}`];
    for (let i = 2; i <= n + 1; i++) defs.push(`[^${i}]: Source ${i}, p. ${i}.`);
    return [...body, ...defs].join("\n");
}

/** How many readings one default lint of `text` builds. */
function lintReadings(text: string): number {
    const before = parseCount();
    lintFootnotes(text);
    return parseCount() - before;
}

describe("the lint's cost under a long first footnote", () => {
    it.fails("grows in step with the footnotes packed under the long one, not with their square", () => {
        const at10 = lintReadings(longFirstPacked(10));
        const at40 = lintReadings(longFirstPacked(40));
        // four times the footnotes may cost about four times the readings;
        // eight times is the square showing (now 86 against about 940)
        expect(at40).toBeLessThanOrEqual(at10 * 6);
    });

    it.fails("stays within a few readings per footnote", () => {
        // 34d5377 read this note 3 times; now about 1,400
        expect(lintReadings(longFirstPacked(50))).toBeLessThan(200);
    });

    it("control: the same note with a short first footnote reads the note a handful of times", () => {
        expect(lintReadings(longFirstPacked(50, false))).toBeLessThan(20);
    });
});
