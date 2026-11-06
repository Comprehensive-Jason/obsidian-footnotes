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
// the note reading, which parses the line the way Obsidian does. The parse
// costs more per character than the old masker did, and a whole suite
// running alongside slows it down by a factor of two or more, so the pin is
// about the growth: the line four times over may take at most eight times
// as long (time growing with the length squared would take sixteen times as
// long; measured 2026-10-03, the quadratic reads took 3.5 to 5 times as long
// for each doubling). Each read is the fastest of three.
//
// Shape 2 misses that limit, and it is marked as an expected failure on
// purpose. The parser is @quartz-community/remark-obsidian 2.1.0, whose
// inline math reader searches the rest of the line again at every "$" that
// finds no closer, so a line of prices takes time growing with the length
// squared. Jason decided on 2026-11-06 to adopt 2.1.0 knowing this, and the
// fix belongs upstream. Measured 2026-11-06: four times the line takes 12 to
// 15 times as long on a quiet machine.

describe("masking a long line of dollars and backticks", () => {
    const shapes = [
        "$ ".repeat(4000),
        "` ".repeat(4000),
        "$5 or $6 and ".repeat(600),
        "`a` ".repeat(2000),
        "[^x] ".repeat(1600),
    ];

    /** The shape the package's math reader is slow on (see the top of this file). */
    const pricesShape = 2;

    /**
     * The fastest of three reads of `line` as a one-line note. Each read is of
     * a new text, so nothing is remembered; `tail` is a run of spaces that
     * keeps one attempt's texts apart from another's.
     */
    const fastest = (line: string, tail = ""): number => {
        let took = Infinity;
        for (let run = 0; run < 3; run++) {
            const text = line + tail + " ".repeat(run + 1);
            const started = performance.now();
            const masked = readNote([text]).maskedLine(0);
            took = Math.min(took, performance.now() - started);
            expect(masked.length).toBe(text.length);
        }
        return took;
    };

    /** The limit itself: the line four times over takes at most eight times as long as the line once. */
    const expectLinearish = (line: string, tail = ""): void => {
        // warm up, then compare the line with four of it in a row
        readNote([line + tail + " warm"]).maskedLine(0);
        const one = fastest(line, tail);
        const four = fastest(line.repeat(4), tail);
        expect(four).toBeLessThan(Math.max(8 * one, 40));
    };

    const others = shapes.map((s, i) => [i, s] as const).filter(([i]) => i !== pricesShape);

    it.each(others)("shape %i masks in linear-ish time", (_i, line) => {
        expectLinearish(line);
    });

    // Expected to fail until upstream fixes its math reader (Jason's decision
    // of 2026-11-06); when it starts passing, vitest reports this test as
    // failed, which is the signal to turn it back into a plain test.
    //
    // The limit is the same as for the other shapes. It must hold on five
    // fresh attempts in a row to count as fixed, because under heavy load one
    // attempt can land under the limit by luck: other work slows the short
    // read more than the long one (measured 2026-11-06 with eight busy
    // processes: 6.2 to 14.3 times as long, under the limit in 2 runs of 8).
    // Vitest's own retry option cannot do this, since it stops at the first
    // attempt that passes.
    it.fails("shape 2 masks in linear-ish time", () => {
        for (let attempt = 1; attempt <= 5; attempt++) expectLinearish(shapes[pricesShape], " ".repeat(attempt * 10));
    }, 60000);

    // The expected failure above would also hide a crash, so this checks that the shape still reads.
    it("shape 2 still masks to a line of the same length", () => {
        const line = shapes[pricesShape];
        expect(readNote([line]).maskedLine(0).length).toBe(line.length);
    });
});
