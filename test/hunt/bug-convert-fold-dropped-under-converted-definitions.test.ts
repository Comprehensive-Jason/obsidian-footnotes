import { describe, expect, it } from "vitest";

import { convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";
import { lineDiffChanges, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): Convert normal footnotes to inline footnotes unfolds a
// folded heading that sits right under the definitions it removes.
//
// What the user would see: the note keeps its definitions under the part
// they belong to (issue #55's layout), and the next heading, "## Part
// two[^2]", carries a footnote of its own. The user has "## Part two"
// folded. After the conversion, that section is open again.
//
// Hunt 2026-10-02, round 4, lens plumbing. Cluster U1.
//
// Source of truth: mapFoldLines' contract in document-diff.ts ("a line
// rewritten in place is still the same line ... A fold whose heading line
// was removed is dropped"); manual sheet 12 ("every fold is still folded"
// after a rewrite); docs/architecture.html (both style conversions keep
// folds).
//
// Severity: low. Nothing in the note is lost; a fold is.
//
// Cause: the conversion deletes the definition line and rewrites the
// heading line in place. The two are neighbours, so the line diff puts
// them in one changed run, and inside a run alignLines pairs old and new
// lines by position from the top: the deleted definition is paired with
// the rewritten heading, and the heading itself counts as removed, which
// drops its fold.

describe("folds through the normal-to-inline conversion", () => {
    it("a folded heading right under the converted definitions stays folded", () => {
        const before = [
            "# Part one",
            "Text[^1].",
            "",
            "[^1]: one",
            "## Part two[^2]",
            "Body of part two.",
            "More of it.",
            "",
            "[^2]: two",
        ].join("\n");
        const result = convertNormalFootnotesToInline(before);
        expect(result.markdown.split("\n")).toEqual([
            "# Part one",
            "Text^[one].",
            "",
            "## Part two^[two]",
            "Body of part two.",
            "More of it.",
        ]);
        // "## Part two" was folded over its body (lines 4 to 7 before).
        const folds = [{ from: 4, to: 7 }];
        // Today: [] (the fold is dropped).
        expect(mapFoldLines(folds, lineDiffChanges(before, result.markdown), before)).toEqual([{ from: 3, to: 5 }]);
    });
});

// The default lint's punctuation rule triggers the same root: it rewrites a heading in place
// right under a definition the lint moves away (hunt 2026-10-05, round 1, cluster PR4).
describe("folds through the default lint", () => {
    it("a heading holding an inline footnote before its period keeps its fold under the default lint", () => {
        const before = ["# H2", "", "[^1]: alpha", "", "# H0^[note].", "", "# H1", "", "alpha", "", "Lorem ipsum[^1]."].join("\n");
        const after = lintFootnotes(before, {});
        expect(after.split("\n").slice(0, 4)).toEqual(["# H2", "", "# H0.^[note]", ""]);
        // "# H0^[note]." was folded over lines 4 and 5. Today: [] (the fold is dropped).
        expect(mapFoldLines([{ from: 4, to: 5 }], lineDiffChanges(before, after), before)).toEqual([{ from: 2, to: 3 }]);
    });
});

// BUG (annoyance), still open: the conversion still drops the fold when
// the heading's own definition holds a link or a wikilink.
//
// What the user would see: the same layout as the first test, but the
// definition of "## Part two[^2]" cites a source with a link,
// "[Smith](https://example.com) p. 5", or a wikilink, "[[Smith 2020]], p. 5".
// After the conversion the heading reads "## Part two^[see [Smith](...) p. 5]",
// and its section is open again.
//
// Hunt 2026-10-05, round 2, lens diff. Cluster D4 (what is left of U1).
//
// Cause: the fix above lines up headings by a key of their level and
// words, with every reference and inline footnote taken out. headingKeys
// takes them out with the pattern /\^?\[\^?[^\]]*\]/, which stops at the
// first "]". In "^[see [Smith](https://example.com) p. 5]" that is the
// "]" after "Smith", so the rest of the link and the page number stay in
// the key. The old and new heading keys differ, the heading is not
// paired, and the fold is dropped as in the first test.
describe("folds through the normal-to-inline conversion, with a link in the heading's definition", () => {
    it.fails("the U1 shape with a link in the heading's definition keeps the fold", () => {
        const before = [
            "# Part one",
            "Text[^1].",
            "",
            "[^1]: one",
            "## Part two[^2]",
            "Body of part two.",
            "More of it.",
            "",
            "[^2]: see [Smith](https://example.com) p. 5",
        ].join("\n");
        const result = convertNormalFootnotesToInline(before);
        expect(result.markdown.split("\n")).toEqual([
            "# Part one",
            "Text^[one].",
            "",
            "## Part two^[see [Smith](https://example.com) p. 5]",
            "Body of part two.",
            "More of it.",
        ]);
        // Today: [] (the fold is dropped).
        expect(mapFoldLines([{ from: 4, to: 7 }], lineDiffChanges(before, result.markdown), before)).toEqual([{ from: 3, to: 5 }]);
    });

    it.fails("the same with a wikilink and a page number", () => {
        const before = [
            "# Part one",
            "Text[^1].",
            "",
            "[^1]: one",
            "## Part two[^2]",
            "Body of part two.",
            "",
            "[^2]: [[Smith 2020]], p. 5",
        ].join("\n");
        const result = convertNormalFootnotesToInline(before);
        expect(result.markdown.split("\n")[3]).toBe("## Part two^[[[Smith 2020]], p. 5]");
        // Today: [] (the fold is dropped).
        expect(mapFoldLines([{ from: 4, to: 6 }], lineDiffChanges(before, result.markdown), before)).toEqual([{ from: 3, to: 4 }]);
    });
});
