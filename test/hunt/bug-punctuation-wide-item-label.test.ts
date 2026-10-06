import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// BUG (wrong output): the punctuation rule breaks a footnote label in a
// list item whose text starts 4 or more columns in.
//
// What the user would see: in a "10." item or a nested item, the user
// wrote "[^b]: lazy" under the item's text (a label that Obsidian reads
// as plain text until a blank line goes above it). The lint turns it into
// ":[^b] lazy": the label is gone, and fixing it by hand means retyping
// it. With the default settings, Fix lazy definitions repairs the plain
// lazy label first, so the default lint mangles the label only when a
// "---" underline sits under it; with Fix lazy definitions off, it
// mangles both.
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L5. Found by
// probe-r2-lint-2's never-silent property.
//
// Source of truth: footnote-after-punctuation.ts's own design (it steps
// over a lazy label's "[^x]:" so the label the user meant stays whole for
// fix-lazy); the narrow-item case, where the label is left whole;
// labelShapedLines (9dc04b1), which reads the same label from where the
// line's containers end, so the alerts and fix-lazy see a label there.
//
// Cause: footnoteAfterPunctuation finds the label to step over with
// definitionLabelIn, which reads it from the line's MARGIN and allows at
// most three spaces before it. At an item's content column of 4 or more
// the label is four spaces in, so the rule takes "[^b]" for a reference
// before a colon and moves it after the colon.
//
// Fixed 2026-10-05: the rule reads a lazy label from where the line's
// containers end, as labelShapedLines does.

describe("the punctuation rule and a label at a wide item's content column", () => {
    it("a lazy label in a 10. item is left whole", () => {
        // Before the fix: "Text.[^b]\n\n10. item\n    :[^b] lazy".
        expect(footnoteAfterPunctuation("Text[^b].\n\n10. item\n    [^b]: lazy")).toBe("Text.[^b]\n\n10. item\n    [^b]: lazy");
    });

    it("the default lint leaves an underlined label in a 10. item whole", () => {
        const out = lintFootnotes("Text[^b].\n\n10. item\n    [^b]: lazy\n    ---", { sectionHeading: "# Footnotes" });
        // Before the fix: "Text.[^b]\n\n10. item\n    :[^b] lazy\n    ---".
        expect(out).toContain("    [^b]: lazy");
    });

    it("the default lint leaves an underlined label in a nested item whole", () => {
        const out = lintFootnotes("Text[^b].\n\n- parent\n  - child\n    [^b]: lazy\n    ---", { sectionHeading: "# Footnotes" });
        // Before the fix: "Text.[^b]\n\n- parent\n  - child\n    :[^b] lazy\n    ---".
        expect(out).toContain("    [^b]: lazy");
    });
});
