import { describe, expect, it } from "vitest";

import { endOfWordOffset } from "../../src/editor/cursor-motion";

// BUG (wrong output): a press inside the text of a link whose text holds
// its own pair of square brackets lands inside the link text.
//
// What the user would see: the line reads "see [Smith [2020] study](u)
// now". With the caret in "Smith", a press writes "[Smith[^1] [2020]
// study](u)": the reference sits inside the link text instead of after
// the whole link.
//
// Hunt 2026-10-02, round 3, lens gram-off. Cluster G7.
//
// Source of truth: CommonMark 0.31.2, section 6.3: link text may contain
// balanced square brackets, so "[Smith [2020] study](u)" is ONE link.
// Jason's landing ruling (2026-09-15): a reference never splits a link;
// it lands after the whole construct.
//
// Cause: linkLikeEndAt in src/parsing/markdown-scan.ts finds links with
// the pattern /\[[^\]\n]*\]\(/, whose link text cannot contain a "]". It
// misses this link entirely, so the ordinary word walk runs and stops
// after "Smith".
//
// Fixed 2026-10-05 (hunt 2026-10-05 fixes, by the way): linkLikeEndAt
// now asks the note reading where the link around the caret ends, and the
// reading reads this one whole.

describe("landing walk: a markdown link whose text holds brackets", () => {
    const line = "see [Smith [2020] study](u) now";

    it("a press in the link text lands after the whole link", () => {
        const caret = line.indexOf("Smith") + 2;
        // Before the fix: 10, right after "Smith"
        expect(endOfWordOffset(line, caret)).toBe(line.indexOf(" now"));
    });
});
