import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";

// spec question: should Convert inline footnotes to normal skip an inline
// footnote whose text holds a reference, as the other direction does?
//
// What it does now: "^[see [^1]]" is converted to a reference whose new
// definition reads "see [^1]", a reference inside a definition. The same
// shape is already nested in the inline form, so nothing new is nested,
// but the conversion writes the nesting into a definition.
// What a user might expect: normal to inline skips a definition whose text
// holds a footnote ("its body holds a footnote"), so the mirror image
// would skip it too, with the same reason.
// Why it is a question and not a bug: ADR 0001 says the plugin never
// creates nesting, and this conversion only moves nesting the user already
// typed. Whether moving it counts as creating it is Jason's call.
//
// Hunt 2026-10-02, round 2, lens convert. Cluster V8.
//
// Source of truth: docs/adr/0001-no-nested-footnotes.md and CONTEXT.md's
// Nested footnote entry ("hand-typed nesting is surfaced by lint, never
// destroyed").
//
// Answered (Jason's ruling B12, 2026-10-08, stage 3 of the result gate
// design): the result gate refuses the conversion as nested, since the
// reference, dead text inside the inline footnote (rule E3), would come
// alive inside the new definition. The test was it.fails until then.
//
// Since Jason's pick of 2026-10-08 (decision 4 of the stage 3 report), the
// conversion skips just that inline footnote and converts the rest, and the
// toast counts it among the skipped ones, "whose body holds a footnote",
// the other direction's reason fitted to this direction's counted list.
// Before, the whole conversion was refused and nothing was converted.

beforeEach(resetNotices);

describe("spec question: an inline footnote whose text holds a reference", () => {
    it("is skipped, and the rest are converted", () => {
        const lines = ["x[^1] a^[see [^1]] b^[plain]", "", "[^1]: one"];
        const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        const result = convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
        expect(result.converted).toBe(1);
        expect(result.refused).toBeUndefined();
        expect(result.skipped).toEqual([{ reason: "whose body holds a footnote", count: 1 }]);
        expect(doc.lines).toEqual(["x[^1] a^[see [^1]] b[^2]", "", "[^1]: one", "[^2]: plain"]);
        expect(messages()).toEqual(["Converted 1 inline footnote into 1 normal footnote. Skipped 1 whose body holds a footnote."]);
    });

    it("alone, it is skipped and nothing is converted", () => {
        const lines = ["x[^1] a^[see [^1]]", "", "[^1]: one"];
        const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        const result = convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
        expect(result.converted).toBe(0);
        expect(doc.lines).toEqual(lines);
        expect(messages()).toEqual(["No inline footnotes converted: skipped 1 whose body holds a footnote."]);
    });

    it("a reference-shaped text in a code span inside it is not a footnote, so it converts", () => {
        const lines = ["a^[see `[^1]`]"];
        const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        const result = convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
        expect(result.converted).toBe(1);
        expect(doc.lines).toEqual(["a[^1]", "", "[^1]: see `[^1]`"]);
    });
});
