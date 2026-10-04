import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// Timing pin for review B1 (2026-09-09): insideReferenceShape walked
// outward from every dollar and backtick candidate, to the start of the
// line whenever no bracket or NUL lay behind it, so a long line of prices
// masked in quadratic time (measured: 1000 chars 14 ms, 8000 chars 344 ms).
// The walk is now answered from tables built once over the raw line. The
// bound is generous on purpose (a timing pin must not flake on a slow
// machine); the old code missed it by an order of magnitude.
//
// Lives under test/perf/ because Stryker's INSTRUMENTED dry run is several
// times slower than plain vitest (527 ms here where plain runs take a few
// ms), which failed the pin and aborted the whole audit; vitest.stryker
// .config.ts excludes this folder. The behavioral half of the pin stays in
// test/hunt/spec-long-line-masking-is-linear.
//
// Since step 2 of the runtime swap (2026-10-03) the masked twin comes from
// the note reading, which parses the line the way Obsidian does; the parse
// had the same trap in two places (every inline reader searching the rest
// of the line at every stretch of text, and every "$" searching the rest of
// the line for a closer), and both now remember their answers
// (textLineByLine and mathWithoutRescans in obsidian-markdown.ts). The
// parse costs more per character than the old masker did, and a whole
// suite running alongside slows it down by a factor of two or more, so the
// pin is about the growth: the line four times over may take at most eight
// times as long (time growing with the length squared would take sixteen
// times as long; measured 2026-10-03, the quadratic reads took 3.5 to 5
// times as long for each doubling). Each read is the fastest of three.

describe("masking a long line of dollars and backticks", () => {
    const shapes = [
        "$ ".repeat(4000),
        "` ".repeat(4000),
        "$5 or $6 and ".repeat(600),
        "`a` ".repeat(2000),
        "[^x] ".repeat(1600),
    ];

    /** The fastest of three reads of `line` as a one-line note; each read is of a new text, so nothing is remembered. */
    const fastest = (line: string): number => {
        let took = Infinity;
        for (let run = 0; run < 3; run++) {
            const started = performance.now();
            const masked = readNote([line + " ".repeat(run + 1)]).maskedLine(0);
            took = Math.min(took, performance.now() - started);
            expect(masked.length).toBe(line.length + run + 1);
        }
        return took;
    };

    it.each(shapes.map((s, i) => [i, s] as const))("shape %i masks in linear-ish time", (_i, line) => {
        // warm up, then compare the line with four of it in a row
        readNote([line + " warm"]).maskedLine(0);
        const one = fastest(line);
        const four = fastest(line.repeat(4));
        expect(four).toBeLessThan(Math.max(8 * one, 40));
    });
});
