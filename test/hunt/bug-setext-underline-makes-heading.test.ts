// Probed in Reading view 2026-09-16 while verifying Kimi hunt cycle 3's setext spec question; pinned and fixed the same day.
import { describe, expect, it } from "vitest";

import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import {
    orphanedFootnoteReferenceNames,
    underlinedDefinitionLabelNames,
} from "../../src/linting/rules/remove-orphaned-references";
import { lazyDefinitionLabelLines } from "../../src/parsing/label-shapes";
import { readNote } from "../../src/parsing/note-reading";

// Obsidian's setext rule, as Reading view renders it (probed 2026-09-16):
//
//   "[^1]: x" over "===" (or "---")   a heading reading "1: x", no footnote
//   "[^1]: x", "lazy", "==="          footnote "x"; "lazy" is a heading
//   "[^1]: x", "    y", "==="         one footnote reading "x y ==="
//   "para", "more", "==="            one paragraph with a literal "==="
//   "text", "==="                    a heading (one line above it)
//
// So a setext underline makes a heading only under a ONE-line paragraph,
// and a definition label line counts as one. The plugin used to read the
// label as a definition and the lazy line as its continuation, so the
// orphan alert told the user to "write the definition" they had written,
// fix-lazy piled blank lines above such a label, and the block walker
// moved and cut the heading line with the footnote.

const scanOf = (doc: string) => {
    const lines = doc.split("\n");
    const reading = readNote(lines);
    const masked = [...readNote(lines).maskedLines()];
    const starts = readNote(lines).labelLines;
    return { lines, reading, masked, starts };
};

describe("a setext underline directly under a definition label", () => {
    it("makes the label line heading text: no definition starts there", () => {
        expect(scanOf("[^1]: x\n===\n\nuse[^1]").starts[0]).toBe(false);
        expect(scanOf("[^1]: x\n---\n\nuse[^1]").starts[0]).toBe(false);
        expect(scanOf("> [^1]: x\n> ===\n\nuse[^1]").starts[0]).toBe(false);
    });

    it("is not a lazy label (no blank line above can help) but an underlined one", () => {
        const { lines } = scanOf("[^1]: x\n===\n\nuse[^1]");
        expect(lazyDefinitionLabelLines(lines)).toEqual([]);
        expect(underlinedDefinitionLabelNames(lines)).toEqual(["1"]);
    });

    it("fix-lazy leaves it alone instead of piling blank lines above it", () => {
        const doc = "para\n[^1]: a\n===\n\nx[^1]";
        expect(fixLazyDefinitions(doc)).toBe(doc);
    });

    it("its reference is not an orphan to delete: the definition is one blank line short", () => {
        expect(orphanedFootnoteReferenceNames("[^1]: x\n===\n\nuse[^1]")).toEqual([]);
    });

    it("control: a blank line between label and underline makes a working definition", () => {
        const { starts } = scanOf("[^1]: x\n\n===\n\nuse[^1]");
        expect(starts[0]).toBe(true);
    });

    it("control: a thematic break of stars, underscores, or spaced dashes is not an underline", () => {
        for (const rule of ["***", "___", "- - -"]) {
            expect(scanOf(`[^1]: x\n${rule}\n\nuse[^1]`).starts[0]).toBe(true);
        }
    });
});

describe("a setext underline under a definition's lazy continuation line", () => {
    it("pulls that line out as a heading: the block ends at the label", () => {
        for (const underline of ["===", "--", "---"]) {
            const { lines } = scanOf(`[^1]: x\nlazy\n${underline}\n\nuse[^1]`);
            expect(readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([{ name: "1", start: 0, end: 0 }]);
        }
    });

    it("control: under an INDENTED continuation the underline is body text (Kimi's spec question)", () => {
        const { lines } = scanOf("[^1]: x\n    y\n===\n\nuse[^1]");
        expect(readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([{ name: "1", start: 0, end: 2 }]);
    });
});

describe("a setext underline under a longer paragraph is literal text", () => {
    it("the paragraph goes on, so the label under the underline is lazy", () => {
        expect(scanOf("para\nmore\n===\n[^2]: b\n\nx[^2]").starts[3]).toBe(false);
        expect(scanOf("para\n[^1]: a\n===\n[^2]: b\n\nx[^1] y[^2]").starts[3]).toBe(false);
    });

    it("control: under a one-line paragraph it is a heading, and the label under it starts", () => {
        expect(scanOf("text\n===\n[^2]: b\n\nx[^2]").starts[2]).toBe(true);
    });
});

describe("a table cannot interrupt a paragraph (probed the same day)", () => {
    it("a header row directly under plain text is no table", () => {
        expect(readNote("text\n| a | b |\n| --- | --- |\n| c | d |".split("\n")).tableRowLines).toEqual([false, false, false, false]);
        expect(readNote("- item\n| a | b |\n| --- | --- |".split("\n")).tableRowLines).toEqual([false, false, false]);
    });

    it("a blank line, a label line, or a definition's lazy line above lets the table start", () => {
        expect(readNote("text\n\n| a | b |\n| --- | --- |".split("\n")).tableRowLines).toEqual([false, false, true, true]);
        expect(readNote("[^1]: x\n| a | b |\n| --- | --- |".split("\n")).tableRowLines).toEqual([false, true, true]);
        expect(readNote("[^1]: x\nlazy\n| a | b |\n| --- | --- |".split("\n")).tableRowLines).toEqual([false, false, true, true]);
    });
});
