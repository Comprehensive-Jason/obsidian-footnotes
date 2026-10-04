import { describe, expect, it } from "vitest";

import { maskInlineRegions } from "../../src/parsing/cell-reading";

// Review B1 (2026-09-09): insideReferenceShape walked outward from every
// dollar and backtick candidate, to the start of the line whenever no
// bracket or NUL lay behind it, so a long line of prices masked in
// quadratic time (measured: 1000 chars 14 ms, 8000 chars 344 ms). The walk
// is now answered from two lazily built state tables. The bound here is
// generous on purpose (a timing pin must not flake on a slow machine); the
// old code missed it by a factor of ten and more. The timing half now lives
// in test/perf/masking-linear.perf.test.ts (Stryker's instrumented dry run
// is several times slower and failed it); this file keeps the guard's
// answers.

describe("masking a long line of dollars and backticks", () => {
    it("keeps the reference guard's answers", () => {
        // a dollar inside a reference shape is id text, not math
        expect(maskInlineRegions("pay[^a$1] and[^b$2] now")).toBe("pay[^a$1] and[^b$2] now");
        // an unclosed "[^" is a bracket: the code span and the math both mask
        const masked = maskInlineRegions("`[^` $[^1].$");
        expect(masked.startsWith("\0\0\0\0")).toBe(true);
        expect(masked.endsWith("\0".repeat(7))).toBe(true);
    });
});
