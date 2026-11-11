import { describe, expect, it } from "vitest";

import { sanitizeInlineFootnoteContent } from "../src/commands/inline-footnotes";

// Spec for what clipboard text may become the body of an inline footnote
// (^[...]). Inline footnotes are single-line by nature, and an unbalanced
// bracket would end the footnote early and corrupt the note - these tests
// ARE those decisions:
//   - whitespace runs (including newlines) collapse to one space, trimmed
//   - balanced brackets pass through so pasted markdown links keep working
//   - unbalanced brackets are escaped so the footnote can't break
//   - empty / whitespace-only input becomes "" (callers refuse to insert)

describe("sanitizeInlineFootnoteContent", () => {
    it("passes plain text through unchanged", () => {
        expect(sanitizeInlineFootnoteContent("a quick note")).toBe("a quick note");
    });

    it("trims leading and trailing whitespace", () => {
        expect(sanitizeInlineFootnoteContent("  padded  ")).toBe("padded");
    });

    it("collapses newlines to single spaces", () => {
        expect(sanitizeInlineFootnoteContent("line one\nline two\r\nline three")).toBe(
            "line one line two line three",
        );
    });

    // Changed 2026-11-11: spaces and tabs on one line used to be squeezed
    // to one space, which changed code and link targets
    // (bug-inline-key-squeezes-spaces-in-code). Only line breaks go now.
    it("keeps a run of spaces and tabs on one line as written", () => {
        expect(sanitizeInlineFootnoteContent("a \t  b")).toBe("a \t  b");
    });

    it("keeps balanced brackets so markdown links survive", () => {
        expect(sanitizeInlineFootnoteContent("see [the docs](https://example.com)")).toBe(
            "see [the docs](https://example.com)",
        );
    });

    it("escapes a lone closing bracket that would end the footnote early", () => {
        expect(sanitizeInlineFootnoteContent("a ] b")).toBe("a \\] b");
    });

    it("escapes a lone opening bracket", () => {
        expect(sanitizeInlineFootnoteContent("a [ b")).toBe("a \\[ b");
    });

    it("escapes every bracket once any are unbalanced", () => {
        expect(sanitizeInlineFootnoteContent("[a] ]")).toBe("\\[a\\] \\]");
    });

    it("treats already-escaped brackets as balanced", () => {
        expect(sanitizeInlineFootnoteContent("a \\] b")).toBe("a \\] b");
    });

    // Pinned from CodeQL js/incomplete-sanitization (2026-07-16): a trailing
    // backslash escapes the wrapper's closing "]", so ^[...] never ends and
    // the note corrupts. An odd-length trailing backslash run is the general
    // case; doubling the dangling one turns it into a literal backslash.
    it("doubles a trailing backslash that would escape the closing bracket", () => {
        expect(sanitizeInlineFootnoteContent("see appendix\\")).toBe("see appendix\\\\");
    });

    it("leaves an even trailing backslash run alone", () => {
        expect(sanitizeInlineFootnoteContent("a\\\\")).toBe("a\\\\");
    });

    it("doubles only the dangling backslash of an odd trailing run", () => {
        expect(sanitizeInlineFootnoteContent("a\\\\\\")).toBe("a\\\\\\\\");
    });

    it("catches a trailing backslash even when brackets are unbalanced", () => {
        expect(sanitizeInlineFootnoteContent("] \\")).toBe("\\] \\\\");
    });

    // escaping every bracket blindly would turn a pre-escaped \] into \\],
    // i.e. a literal backslash followed by a live bracket
    it("keeps pre-escaped brackets intact when escaping unbalanced text", () => {
        expect(sanitizeInlineFootnoteContent("a \\] b ]")).toBe("a \\] b \\]");
    });

    it("returns empty string for empty input", () => {
        expect(sanitizeInlineFootnoteContent("")).toBe("");
    });

    it("returns empty string for whitespace-only input", () => {
        expect(sanitizeInlineFootnoteContent(" \n\t ")).toBe("");
    });
});
