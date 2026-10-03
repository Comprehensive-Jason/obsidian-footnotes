import { describe, expect, it } from "vitest";

import { inItemDefinitionLabels } from "../helpers/in-item";
import { orphanedFootnoteReferenceNames } from "../../src/linting/rules/remove-orphaned-references";

// BUG (wrong output): the reader for list-item definitions counts two
// lines that are no definitions, so the orphan alert stays silent about
// references that have none.
//
// What the user would see: "para" is followed directly by
// "2. [^x]: def". A list numbered other than 1 cannot interrupt a
// paragraph, so this line is just more paragraph text, and "[^x]" further
// down has no definition. The plugin counts it as a list-item definition,
// so the orphan-reference alert says nothing about "[^x]". The same
// happens with "- [^8]: commented out" inside a "%%" comment block, which
// Obsidian hides entirely.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X12.
//
// Source of truth: CommonMark 5.2 (only a list starting at 1 can
// interrupt a paragraph) and the ground truth of 2026-09-09 (a label
// inside a "%%" block comment is dead).
//
// Fixed by the runtime swap (2026-10-03): the note reading decides where
// list items are, as Obsidian does, so neither line is a definition.
//
// Cause: inItemDefinitionLabels looks for a list marker on the line
// without asking whether a list item can open there, or whether the line
// is inside a comment.

// The list-item definitions the reader finds in `doc`.
function inItem(doc: string) {
    return inItemDefinitionLabels(doc.split("\n"));
}

describe("in-item labels where no list item can be", () => {
    it("'2. [^x]: def' under prose is lazy paragraph text (2. does not interrupt), not an in-item definition", () => {
        const doc = "para\n2. [^x]: def\n\nuse[^x]";
        expect(inItem(doc)).toEqual([]);
        expect(orphanedFootnoteReferenceNames(doc)).toContain("x");
    });

    it("'- [^8]: x' inside a %% block is not an in-item definition", () => {
        expect(inItem("%%\n- [^8]: commented out\n%%\n\nuse[^8]")).toEqual([]);
    });
});
