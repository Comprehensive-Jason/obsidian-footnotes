import { describe, expect, it } from "vitest";

import { convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";
import { lineDiffChanges, mapFoldLines } from "../../src/editor/document-diff";

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
    it.fails("a folded heading right under the converted definitions stays folded", () => {
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
