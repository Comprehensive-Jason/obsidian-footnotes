import { describe, expect, it } from "vitest";

import { footnoteFacts } from "../../src/parsing/footnote-facts";

// Timing pin (the speed brief, 2026-10-03): a "%%" left open near the top
// of a long note makes the rest of the note one run of inline text, and
// remark-parse's text reader searched that whole run again for every
// stretch of plain text it read, once per inline reader. Reading the
// 5,600-line speed-test note with a "%%" open at line 101 took about 3
// seconds (a whole-note parse is about a tenth of a second), and the
// 22,400-line one a minute and a half. The text reader is now handed one
// line at a time (textLineByLine in src/parsing/obsidian-markdown.ts).
//
// Like the other timing pins, this one compares two reads made the same
// way rather than using a fixed limit, so it holds on a slow or a fast
// machine: the note with the comment left open must read about as fast as
// the same note with the comment closed at once. Before the fix the open
// one took about eight times as long at 2,000 lines, and the gap grows with
// the note. Under test/perf/ so the Stryker dry run leaves it out.

/** 2,000 lines of prose citing a footnote now and then, in paragraphs, under `top`. */
function note(top: string[]): string {
    const lines = [...top];
    for (let i = 0; i < 2000; i++) {
        lines.push(i % 10 === 9 ? "" : `Line ${i} of the long comment, citing a source[^${i}] and going on a little.`);
    }
    return lines.join("\n");
}

/** The fastest of three runs of `run`, in milliseconds. */
function best(run: () => void): number {
    let min = Infinity;
    for (let i = 0; i < 3; i++) {
        const started = performance.now();
        run();
        min = Math.min(min, performance.now() - started);
    }
    return min;
}

describe("a long note under a '%%' left open", () => {
    it("reads about as fast as the same note with the comment closed", () => {
        const open = note(["Intro.", "", "%%"]);
        const closed = note(["Intro.", "", "%% a closed comment %%"]);
        // the open comment hides nothing from the reading: its references still count (Jason's ruling, 2026-10-03)
        expect(footnoteFacts(open).references).toHaveLength(1800);
        const openMs = best(() => footnoteFacts(open));
        const closedMs = best(() => footnoteFacts(closed));
        expect(openMs).toBeLessThan(3 * closedMs + 20);
    });
});
