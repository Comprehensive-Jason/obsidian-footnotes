import { describe, expect, it } from "vitest";

import { applyFootnotePrefix } from "../src/linting/rules/apply-footnote-prefix";
import { lintFootnotes } from "../src/linting/linter";

// QOL (2026-07-18): footnotes written BEFORE the note got its
// footnote-prefix property stay unprefixed; the lint rule renames them to
// carry the prefix. Policy pinned here:
//   - plain numbered footnotes convert in first-appearance order
//   - numbering continues after the highest existing prefixed footnote, so
//     nothing collides
//   - named footnotes get the prefix too, keeping their name (a bug of
//     2026-07-20) - unless the prefixed name already exists as another
//     footnote, which a rename would silently merge
//   - already-prefixed footnotes are untouched
//   - protected regions (code, comments, frontmatter) are invisible
//   - an invalid prefix (defensive: the lint guard cancels earlier anyway)
//     changes nothing

describe("applyFootnotePrefix", () => {
    it("returns the text unchanged without a prefix", () => {
        const text = "a[^1] b\n\n[^1]: one";
        expect(applyFootnotePrefix(text, "")).toBe(text);
    });

    it("converts plain numbered footnotes in appearance order", () => {
        const input = "b[^2] a[^1] end\n\n[^1]: one\n[^2]: two";
        const expected =
            "b[^3.1] a[^3.2] end\n\n[^3.2]: one\n[^3.1]: two";
        expect(applyFootnotePrefix(input, "3.")).toBe(expected);
    });

    it("continues numbering after the highest existing prefixed footnote", () => {
        const input = "a[^1] b[^2.5] end\n\n[^1]: one\n[^2.5]: five";
        const expected = "a[^2.6] b[^2.5] end\n\n[^2.6]: one\n[^2.5]: five";
        expect(applyFootnotePrefix(input, "2.")).toBe(expected);
    });

    it("prefixes named footnotes, keeping their names (bug of 2026-07-20)", () => {
        const input = "x[^note] y[^1] end\n\n[^note]: n\n[^1]: one";
        const expected = "x[^2.note] y[^2.1] end\n\n[^2.note]: n\n[^2.1]: one";
        expect(applyFootnotePrefix(input, "2.")).toBe(expected);
    });

    it("leaves already-prefixed named footnotes alone", () => {
        const text = "x[^2.note] end\n\n[^2.note]: n";
        expect(applyFootnotePrefix(text, "2.")).toBe(text);
    });

    it("matches an existing prefix case-insensitively", () => {
        const text = "x[^ch-note] y[^Ch-3] end\n\n[^ch-note]: n\n[^Ch-3]: t";
        expect(applyFootnotePrefix(text, "Ch-")).toBe(text);
    });

    it("prefixes a named orphan definition", () => {
        const input = "no references here\n\n[^lonely]: orphan";
        const expected = "no references here\n\n[^2.lonely]: orphan";
        expect(applyFootnotePrefix(input, "2.")).toBe(expected);
    });

    it("skips a named rename that would merge two footnotes", () => {
        // renaming [^note] to [^2.note] would collide with the existing
        // [^2.note] and silently fuse their contents - leave it alone
        const input =
            "x[^note] y[^2.note] end\n\n[^note]: a\n[^2.note]: b";
        expect(applyFootnotePrefix(input, "2.")).toBe(input);
    });

    it("prefixes a foreign-prefixed name like any other named footnote", () => {
        const input = "a[^3.5] end\n\n[^3.5]: other chapter";
        const expected = "a[^2.3.5] end\n\n[^2.3.5]: other chapter";
        expect(applyFootnotePrefix(input, "2.")).toBe(expected);
    });

    it("moves every use of a repeated reference together", () => {
        const input = "a[^7] b[^7] end\n\n[^7]: seven";
        const expected = "a[^2.1] b[^2.1] end\n\n[^2.1]: seven";
        expect(applyFootnotePrefix(input, "2.")).toBe(expected);
    });

    it("prefixes orphaned numbered definitions after the referenced ones", () => {
        const input = "t[^3] end\n\n[^3]: used\n[^9]: orphan";
        const expected = "t[^2.1] end\n\n[^2.1]: used\n[^2.2]: orphan";
        expect(applyFootnotePrefix(input, "2.")).toBe(expected);
    });

    it("never touches protected regions", () => {
        const input = [
            "---",
            "footnote-prefix: 2.",
            "---",
            "real[^1] and `[^2]` inline",
            "",
            "```",
            "[^3]: fenced fake",
            "```",
            "",
            "[^1]: one",
        ].join("\n");
        const expected = [
            "---",
            "footnote-prefix: 2.",
            "---",
            "real[^2.1] and `[^2]` inline",
            "",
            "```",
            "[^3]: fenced fake",
            "```",
            "",
            "[^2.1]: one",
        ].join("\n");
        expect(applyFootnotePrefix(input, "2.")).toBe(expected);
    });

    it("refuses an invalid prefix (defense in depth)", () => {
        const text = "a[^1] b\n\n[^1]: one";
        expect(applyFootnotePrefix(text, "10")).toBe(text);
    });

    it("is idempotent", () => {
        const once = applyFootnotePrefix(
            "b[^2] a[^1] c[^9.9] end\n\n[^1]: one\n[^2]: two\n[^9.9]: pre",
            "9.",
        );
        expect(applyFootnotePrefix(once, "9.")).toBe(once);
    });
});

describe("lintFootnotes with applyNotePrefix", () => {
    it("reads the note's property and prefixes after reindexing", () => {
        const input =
            "---\nfootnote-prefix: 2.\n---\nb[^2] a[^1] end\n\n[^1]: one\n[^2]: two";
        const expected =
            "---\nfootnote-prefix: 2.\n---\nb[^2.1] a[^2.2] end\n\n[^2.1]: two\n[^2.2]: one";
        expect(lintFootnotes(input, { applyNotePrefix: true })).toBe(expected);
    });

    it("does nothing without the note property", () => {
        const input = "b[^2] a[^1] end\n\n[^1]: one\n[^2]: two";
        const expected = "b[^1] a[^2] end\n\n[^1]: two\n[^2]: one";
        expect(lintFootnotes(input, { applyNotePrefix: true })).toBe(expected);
    });

    it("does nothing when the option is off", () => {
        const input =
            "---\nfootnote-prefix: 2.\n---\nb[^2] a[^1] end\n\n[^1]: one\n[^2]: two";
        const expected =
            "---\nfootnote-prefix: 2.\n---\nb[^1] a[^2] end\n\n[^1]: two\n[^2]: one";
        expect(lintFootnotes(input, { applyNotePrefix: false })).toBe(expected);
    });

    it("is idempotent through the whole pipeline", () => {
        const messy =
            "---\nfootnote-prefix: 2.\n---\nc[^9], b[^2.4] a[^1]\n\n[^1]: one\n[^9]: nine\n[^2.4]: pre";
        const once = lintFootnotes(messy, { applyNotePrefix: true });
        expect(lintFootnotes(once, { applyNotePrefix: true })).toBe(once);
    });
});
