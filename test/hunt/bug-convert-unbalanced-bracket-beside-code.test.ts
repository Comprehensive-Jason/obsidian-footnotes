import { describe, expect, it } from "vitest";

import { convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";
import { inlineFootnoteSpans } from "../../src/parsing/footnote-grammar";
import { maskProtectedLines, scanDocument } from "../../src/parsing/markdown-scan";

// BUG (wrong output): converting a footnote whose text has a lone "[" and a
// "]" inside a code span writes something that is no longer a footnote.
//
// What the user would see: the definition reads
// "[^1]: see [note and `a]`". After Convert normal footnotes to inline the
// line holds "x^[see [note and `a]`]". The "]" inside the code span cannot
// close anything, so the lone "[" swallows the inline footnote's own
// closing bracket: the note shows the footnote's text as plain bracketed
// prose, and Convert inline footnotes to normal finds nothing to convert
// back.
//
// Hunt 2026-10-02, round 2, lens convert. Cluster V3.
//
// Source of truth: the plugin's own scanner. What the converter writes has
// to read as one inline footnote to inlineFootnoteSpans over the masked
// line, or the reference has silently become plain text. CommonMark reads
// the code span before the brackets, which is what the scanner models.
//
// Cause: the converter's bracket balancing pairs the lone "[" with the "]"
// inside the code span, so it escapes nothing.

describe("an unbalanced '[' outside code next to a ']' inside code", () => {
    it.fails("the output is still an inline footnote to the plugin's own scanner", () => {
        const out = convertNormalFootnotesToInline("x[^1]\n\n[^1]: see [note and `a]`").markdown;
        // Today out is "x^[see [note and `a]`]", which the scanner reads as no inline footnote.
        const lines = out.split("\n");
        const masked = maskProtectedLines(lines, scanDocument(lines));
        expect(inlineFootnoteSpans(masked[0])).toHaveLength(1);
    });
});
