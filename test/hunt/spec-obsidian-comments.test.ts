import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { buildDefinitionAppend } from "../../src/commands/definition-append";
import { docContext } from "../../src/editor/doc-context";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { orphanedFootnoteDefinitionNames } from "../../src/linting/rules/remove-orphaned-definitions";
import {
    lazyDefinitionLabelNames,
    orphanedFootnoteReferenceNames,
} from "../../src/linting/rules/remove-orphaned-references";
import {
    definitionStartLines,
    findDefinitionBlocks,
    maskProtectedLines,
    scanDocument,
} from "../../src/parsing/markdown-scan";

// Obsidian "%%" comments (Jason, 2026-09-09: "make the plugin behavior
// match Obsidian's recognition"). Ground truth in the live Reading view
// the same day, ~80 shapes:
// - a comment hides text, but Obsidian still PARSES it: a reference inside
//   a comment - inline or block - is a real reference: it binds its
//   definition (the entry renders in the footnote list) and takes a number
//   in appearance order, though its own superscript is hidden;
// - a definition inside a %% BLOCK comment is dead (its reference renders
//   as plain text); a label can never start inside an inline comment
//   because the "%%" precedes it on the line;
// - a "%%" at the START of a line (after blockquote markers, an optional
//   list marker, up to three spaces - or a definition continuation's
//   indent) with no second "%%" on that line opens a block comment that
//   hides everything through the next "%%" anywhere in a later line
//   (escapes and backticks do not shield that closer; text after it is
//   live); a mid-line "%%" pairs only within its own line and is literal
//   when unpaired; a block lives in the container that opened it; an
//   unclosed block runs to the end of the note;
// - a comment-only line ("%% c %%") is still a paragraph line, so a label
//   directly under it is lazy text - while an HTML comment line is a BLOCK
//   (CommonMark), so a label directly under "<!-- c -->" or under a "-->"
//   closer line is a definition (the plugin got that one wrong before).
// Unlike HTML comments, code, and math (whose references do NOT bind),
// %% comments therefore hide nothing from the reference side: the scanner
// flags block-comment lines for the DEFINITION readers only.

const scanOf = (doc: string) => scanDocument(doc.split("\n"));
const blocksOf = (doc: string) => {
    const lines = doc.split("\n");
    return findDefinitionBlocks(lines, scanDocument(lines)).map((b) => `${b.name}@${b.start}`);
};
const lazyOf = (doc: string) => {
    const lines = doc.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    return lazyDefinitionLabelNames(lines, scan, masked, definitionStartLines(lines, scan, (i) => masked[i]));
};

describe("a %% block comment kills the definitions inside it, not the references", () => {
    it("flags the opener, interior, and closer lines, and protects none of them", () => {
        const scan = scanOf("x[^1]\n\n%%\n[^1]: def\n%%\nafter");
        expect(scan.inCommentBlock).toEqual([false, false, true, true, true, false]);
        expect(scan.commentBlockCloseAt).toEqual([-1, -1, -1, -1, 2, -1]);
        expect(scan.isProtected).toEqual([false, false, false, false, false, false]);
    });

    it("a commented definition is dead: its visible reference is an orphan", () => {
        const doc = "x[^1]\n\n%%\n[^1]: def\n%%";
        expect(blocksOf(doc)).toEqual([]);
        expect(orphanedFootnoteReferenceNames(doc)).toEqual(["1"]);
    });

    it("a hidden reference binds: the definition it points at is no orphan", () => {
        const doc = "x[^1]\n\n%%\nhidden[^2]\n%%\n\n[^1]: one\n[^2]: two";
        expect(orphanedFootnoteDefinitionNames(doc)).toEqual([]);
        expect(orphanedFootnoteReferenceNames(doc)).toEqual([]);
    });

    it("a hidden reference takes its number in appearance order, block or inline", () => {
        expect(reindexFootnotes("%%\nx[^9]\n%%\nthen[^8]\n\n[^8]: A\n[^9]: B")).toBe(
            "%%\nx[^1]\n%%\nthen[^2]\n\n[^1]: B\n[^2]: A",
        );
        expect(reindexFootnotes("%%x[^9]%% then[^8]\n\n[^8]: A\n[^9]: B")).toBe(
            "%%x[^1]%% then[^2]\n\n[^1]: B\n[^2]: A",
        );
    });

    it("the commented label is neither lazy nor moved nor fixed", () => {
        const doc = "x[^1]\n\n%%\n[^1]: dead\n%%";
        expect(lazyOf(doc)).toEqual([]);
        expect(fixLazyDefinitions(doc)).toBe(doc);
        expect(moveFootnoteDefinitionsToBottom(doc)).toBe(doc);
    });
});

describe("what opens a block comment", () => {
    it.each([
        ["bare at column 0", "x[^1]\n\n%%\n[^1]: dead\n%%"],
        ["with text after the opener", "x[^1]\n\n%%text\n[^1]: dead\n%%"],
        ["one to three spaces in", "x[^1]\n\n   %%\n[^1]: dead\n%%"],
        ["behind a quote marker", "x[^1]\n\n> %%\n> [^1]: dead\n> %%"],
        ["on a list-item line", "x[^1]\n\n- %%\n  [^1]: dead\n  %%"],
        ["on a numbered-list line", "x[^1]\n\n1. %%\n   [^1]: dead\n   %%"],
        ["right after frontmatter", "---\ntitle: t\n---\n%%\n[^1]: dead\n%%\nx[^1]"],
        ["across a blank line", "x[^1]\n\n%%\n\n[^1]: dead\n\n%%"],
    ])("%s", (_name, doc) => {
        expect(blocksOf(doc)).toEqual([]);
    });

    it.each([
        ["a mid-line %% is literal, even unpaired", "text %% literal\n\n[^1]: def\n\nx[^1]", ["1@2"]],
        ["an inline pair plus a trailing %% is no opener", "%% a %% b %%\n\n[^1]: def\n\nx[^1]", ["1@2"]],
        ["%%%% is an empty inline pair", "%%%% x[^1]\n\n[^1]: def", ["1@2"]],
        ["four spaces in is indented code, and the label under it starts fresh", "x[^1]\n\n    %%\n[^1]: def\n    %%", ["1@3"]],
        ["a closer inside backticks still closes", "%%\nh `%%` after\n\n[^1]: def\n\nx[^1]", ["1@3"]],
    ])("%s", (_name, doc, blocks) => {
        expect(blocksOf(doc)).toEqual(blocks);
    });

    it("an opener line with a second %% is an inline comment, not a block", () => {
        expect(blocksOf("%% `%%` x[^1]\n\n[^1]: def")).toEqual(["1@2"]);
        expect(orphanedFootnoteReferenceNames("%% `%%` x[^1]\n\n[^1]: def")).toEqual([]);
    });
});

describe("where a block comment ends", () => {
    it("at the first %% of a later line; a label directly under a bare closer is a definition", () => {
        expect(blocksOf("x[^1] y[^2]\n\n%%\nh\n%%\n[^1]: one\n[^2]: two")).toEqual(["1@5", "2@6"]);
    });

    it("a mid-line closer frees the rest of its line", () => {
        const doc = "%%\nhidden\nend %% after[^2]\n\n[^2]: two";
        expect(blocksOf(doc)).toEqual(["2@4"]);
        expect(orphanedFootnoteReferenceNames(doc)).toEqual([]);
        expect(scanOf(doc).commentBlockCloseAt[2]).toBe("end %%".length);
    });

    it("with its blockquote: the quote's end closes an unclosed quoted block", () => {
        const doc = "x[^1]\n\n> %%\n> [^1]: dead\n\n[^1]: live";
        expect(blocksOf(doc)).toEqual(["1@5"]);
        expect(scanOf(doc).inCommentBlock).toEqual([false, false, true, true, false, false]);
    });

    it("an unclosed block runs to the end of the note and hides every label after it", () => {
        const doc = "x[^1]\n\n%%\n[^1]: dead\n\nmore\n\n[^1]: also dead";
        expect(blocksOf(doc)).toEqual([]);
        expect(scanOf(doc).endsProtected).toBe(true);
    });

    it("inside a definition continuation, an indented opener hides the rest of the body", () => {
        const doc = "x[^1]\n\n[^1]: def\n    %%\n    hidden[^2]\n    %%\n\n[^2]: two";
        expect(blocksOf(doc)).toEqual(["1@2", "2@7"]);
        expect(orphanedFootnoteDefinitionNames(doc)).toEqual([]);
    });
});

describe("appending and gathering never land inside an unclosed block comment", () => {
    it("the definition append lands above the opener line, like an unclosed HTML comment", () => {
        const doc = fakeEditor(["alpha[^1].", "", "%% open", "hidden"]);
        const { change } = buildDefinitionAppend(docContext(doc), "2", false, fakePlugin());
        expect(change).toEqual({
            from: { line: 0, ch: "alpha[^1].".length },
            text: "\n\n[^2]: ",
        });
    });

    it("move-to-bottom leaves a note alone whose end is commented out", () => {
        const doc = "a[^1]\n\n[^1]: def\n\ntail\n%%\nopen";
        expect(moveFootnoteDefinitionsToBottom(doc)).toBe(doc);
    });
});

describe("the prose-label rule and comment lines", () => {
    it("a comment-only %% line is a paragraph line: the label under it is lazy, and the fix gives it a blank line", () => {
        const doc = "x[^1]\n\n%% c %%\n[^1]: def";
        expect(lazyOf(doc)).toEqual(["1"]);
        expect(fixLazyDefinitions(doc)).toBe("x[^1]\n\n%% c %%\n\n[^1]: def");
    });

    it("an HTML comment line is a block: the label under it is a definition", () => {
        expect(blocksOf("x[^1]\n\n<!-- c -->\n[^1]: def")).toEqual(["1@3"]);
        expect(lazyOf("x[^1]\n\n<!-- c -->\n[^1]: def")).toEqual([]);
        expect(blocksOf("x[^1]\n\n<!--\nc\n-->\n[^1]: def")).toEqual(["1@5"]);
    });

    it("an indented closer inside a definition still continues that definition", () => {
        const doc = "x[^1] y[^2]\n\n[^1]: def\n    <!-- a\n    b -->\n    more\n[^2]: two";
        const lines = doc.split("\n");
        const blocks = findDefinitionBlocks(lines, scanDocument(lines)).map((b) => `${b.name}@${b.start}-${b.end}`);
        expect(blocks).toEqual(["1@2-5", "2@6-6"]);
    });
});
