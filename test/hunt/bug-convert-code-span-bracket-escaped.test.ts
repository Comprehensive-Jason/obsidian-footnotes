import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { convertInlineFootnotesToNormal, convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";

// BUG (wrong output): converting a footnote to inline puts a backslash in
// front of a "]" inside a code span of its text, and converting back keeps
// that backslash for good.
//
// What the user would see: the definition reads "[^1]: use `a]b` here".
// After Convert normal footnotes to inline the line holds
// "x^[use `a\]b` here]", and the footnote shows the code as "a\]b" with a
// visible backslash. Converting back to normal writes
// "[^1]: use `a\]b` here" into the definition, so the code has changed.
//
// Hunt 2026-10-02, round 2, lens convert. Cluster V2.
//
// Source of truth: CommonMark (a code span is read before brackets, and a
// backslash inside a code span is a literal backslash, not an escape). The
// plugin's own inlineFootnoteSpans already masks code spans (its
// docstring), so a "]" inside one cannot end the inline footnote and needs
// no escape.
//
// Cause: the normal-to-inline converter escapes unbalanced brackets in the
// body without skipping code spans.

// Runs the inline-to-normal command on a fake editor holding `lines`.
function run(lines: string[]) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
    convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
    return doc;
}

// Converts `lines` to inline as plain text, then back to normal in the editor.
function roundTrip(lines: string[]) {
    const inline = convertNormalFootnotesToInline(lines.join("\n")).markdown;
    return run(inline.split("\n"));
}

beforeEach(resetNotices);

describe("a ']' inside a code span in a footnote's text", () => {
    it.fails("normal to inline does not escape the ']' inside the code span", () => {
        const out = convertNormalFootnotesToInline("x[^1]\n\n[^1]: use `a]b` here").markdown;
        // Today: "x^[use `a\]b` here]".
        expect(out).toBe("x^[use `a]b` here]");
    });

    it.fails("round trip: the code span comes back without a backslash in the code", () => {
        const doc = roundTrip(["x[^1]", "", "[^1]: use `a]b` here"]);
        // Today the definition comes back as "[^1]: use `a\]b` here".
        expect(doc.lines).toEqual(["x[^1]", "", "[^1]: use `a]b` here"]);
    });
});
