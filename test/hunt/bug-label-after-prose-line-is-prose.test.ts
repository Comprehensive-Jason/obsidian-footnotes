import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";

import { listExistingFootnoteDefinitions } from "../../src/editor/doc-context";
import { lintFootnotes } from "../../src/linting/linter";
import {
    orphanedFootnoteReferenceNames,
    removeOrphanedFootnoteReferences,
} from "../../src/linting/rules/remove-orphaned-references";
import { orphanedFootnoteDefinitionNames } from "../../src/linting/rules/remove-orphaned-definitions";
import { readNote } from "../../src/parsing/note-reading";

// Obsidian, like CommonMark for link reference definitions, does not let a
// footnote definition interrupt a paragraph: a "[^x]:" line directly under
// a prose line (paragraph text, a list item, a quote line, a table row) is
// lazy paragraph text and renders as plain "[^x]: ..." with no footnote.
// Ground truth in Reading view, 2026-09-09 (manual sheet 14): ten shapes,
// definitions only after a blank line, the note start, a heading, a closed
// fence, or another definition. The plugin read a label as a definition
// wherever it sat, so it listed and navigated to "definitions" Obsidian
// showed as text, stayed quiet about the unresolved reference, and its
// lint promoted the line into a real footnote by inserting the blank line.
// Jason's decision (2026-09-09): match Obsidian; the orphan alert explains
// the situation and the user adds the blank line.

const blocksOf = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).blocks.map((b) => `${b.name}@${b.start}`);
};

describe("a label directly under a prose line is prose, not a definition", () => {
    it("is not a definition block after a paragraph, list item, quote line, or table row", () => {
        expect(blocksOf("a[^1]\npara\n[^1]: mid")).toEqual([]);
        expect(blocksOf("para\n[^1]: mid\n\nuse[^1]")).toEqual([]);
        expect(blocksOf("a[^1]\npara\n  [^1]: mid")).toEqual([]);
        expect(blocksOf("a[^1]\n- item\n[^1]: mid")).toEqual([]);
        expect(blocksOf("a[^1]\n> quote\n[^1]: mid")).toEqual([]);
        // a label under a TABLE row is a definition (a definition ends the
        // table the way any block does; Jason's ruling A2, 2026-09-15), so
        // the table case that used to sit here moved to
        // spec-fix-lazy-label-mid-table
        // two labels under a paragraph: the first is lazy prose, so the
        // second follows prose too
        expect(blocksOf("a[^1] b[^2]\n[^2]: first\n[^1]: mid")).toEqual([]);
        // a lazy continuation keeps the paragraph open
        expect(blocksOf("para\n    lazy\n[^1]: mid")).toEqual([]);
    });

    it("is a definition after a blank line, the note start, a heading, a closed fence, or a definition", () => {
        expect(blocksOf("a[^1]\npara\n\n[^1]: mid")).toEqual(["1@3"]);
        expect(blocksOf("[^1]: first line of the note")).toEqual(["1@0"]);
        expect(blocksOf("a[^1]\n# Heading\n[^1]: mid")).toEqual(["1@2"]);
        expect(blocksOf("a[^1]\n```\ncode\n```\n[^1]: mid")).toEqual(["1@4"]);
        expect(blocksOf("a[^1]\n---\n[^1]: mid")).toEqual(["1@2"]);
        expect(blocksOf("x\n\n[^1]: one\n[^2]: two")).toEqual(["1@2", "2@3"]);
        expect(blocksOf("x\n\n[^1]: one\n    more\n[^2]: two")).toEqual(["1@2", "2@4"]);
        expect(blocksOf("---\ntitle: t\n---\n[^1]: right after frontmatter")).toEqual(["1@3"]);
    });

    it("the same rule holds for blockquoted labels", () => {
        expect(orphanedFootnoteDefinitionNames("> para\n> [^q]: quoted under prose")).toEqual([]);
        expect(orphanedFootnoteDefinitionNames("> [^q]: quoted at the start")).toEqual(["q"]);
        expect(orphanedFootnoteDefinitionNames("> para\n>\n> [^q]: after a quote blank")).toEqual(["q"]);
    });

    it("the lint leaves the note alone and never deletes the reference", () => {
        const doc = "a[^1]\npara\n[^1]: mid";
        // with the hidden-definition fix off (on, the lint inserts the blank
        // line itself - test/fix-lazy-definitions.test.ts); this pins the
        // lazy semantics the fix is built on
        expect(lintFootnotes(doc, { fixLazyDefinitions: false })).toBe(doc);
        // a reference pointing at a lazy label is NOT an orphan: the fix is a
        // blank line (the lazy-definition alert says so), never a deletion
        expect(orphanedFootnoteReferenceNames(doc)).toEqual([]);
        expect(removeOrphanedFootnoteReferences(doc)).toBe(doc);
        // a reference with no label anywhere still is one
        expect(orphanedFootnoteReferenceNames("a[^1]\npara\n[^2]: mid")).toEqual(["1"]);
    });

    it("the press-side definition list agrees", () => {
        const prose = fakeEditor(["a[^1]", "para", "[^1]: mid"], { cursor: { line: 0, ch: 0 }, wholeDoc: true });
        expect(listExistingFootnoteDefinitions(prose)).toEqual([]);
        const real = fakeEditor(["a[^1]", "", "[^1]: mid"], { cursor: { line: 0, ch: 0 }, wholeDoc: true });
        expect(listExistingFootnoteDefinitions(real)).toEqual(["1"]);
    });
});
