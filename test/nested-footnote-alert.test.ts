import { describe, expect, it } from "vitest";

import { nestedFootnoteDefinitionNames } from "../src/linting/lint-alerts";

// The nested-footnote lint alert (2026-08-24): nesting is prevented at
// creation plugin-wide, and hand-typed nesting can't be auto-fixed
// without losing content - so the lint names the definitions that carry a
// footnote inside their block, following the never-silent policy orphans
// and duplicates already have. The lint TRANSFORMS still leave nested
// notes intact and stable (test/nested-footnote-lint.test.ts).

function names(doc: string): string[] {
    const lines = doc.split("\n");
    return nestedFootnoteDefinitionNames(lines);
}

describe("nestedFootnoteDefinitionNames", () => {
    it("a clean definition reports nothing - the label itself is not a nested reference", () => {
        expect(names("a[^1].\n\n[^1]: plain body")).toEqual([]);
    });

    it("a reference on the label line, after the label, is reported", () => {
        expect(names("a[^1] b[^2].\n\n[^1]: body cites[^2] here\n[^2]: two")).toEqual(["1"]);
    });

    it("a reference on a continuation line is reported", () => {
        expect(
            names("a[^1] b[^2].\n\n[^1]: first line\n    continues with[^2] here\n[^2]: two"),
        ).toEqual(["1"]);
    });

    it("an inline footnote inside a definition is reported", () => {
        expect(names("a[^1].\n\n[^1]: body with ^[an inline note] tail")).toEqual(["1"]);
    });

    it("a SELF-referencing definition is reported too", () => {
        expect(names("a[^1].\n\n[^1]: cites [^1] itself")).toEqual(["1"]);
    });

    it("a reference-shaped fake inside a code span does not count", () => {
        expect(names("a[^1].\n\n[^1]: body with `fake [^2]` code")).toEqual([]);
    });

    it("several nesting definitions are all named", () => {
        expect(
            names(
                "a[^1] b[^2] c[^3].\n\n[^1]: cites[^3]\n[^2]: has ^[inline]\n[^3]: clean",
            ),
        ).toEqual(["1", "2"]);
    });
});
