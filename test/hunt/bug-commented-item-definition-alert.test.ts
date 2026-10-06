import { describe, expect, it } from "vitest";

import { commentedDefinitionNames } from "../../src/linting/lint-alerts";

// BUG (annoyance): the lint's alert for a definition hidden inside a "%%"
// block comment misses one written in a list item.
//
// What the user would see: inside a "%%" comment, the user has
// "- [^x]: hidden in item" or "1. [^x]: hidden in ordered item". Obsidian
// never shows a definition inside a comment, so [^x] shows nothing, but
// the alert that names commented-out definitions says nothing about it.
// The same label at the margin or behind a quote marker is named.
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L11 (the known unpinned
// minor of the round-2 brief).
//
// Source of truth: Jason's ruling A1 (2026-09-15: the lint names a
// definition inside a block comment); Jason's ruling 1, option a
// (2026-10-03: a definition in a list item counts like any other); the
// margin and quoted cases, which are named today.
//
// Cause: commentedDefinitionNames reads each line's label with
// definitionLabelWithName, which looks for it at the line's margin or
// behind quote markers only, so a label behind a list marker is not found.
// labelShapedLines (9dc04b1) reads a label from where the line's
// containers end, list markers included.
//
// Fix (2026-10-06): the alert reads a commented line's label from where
// the containers around the comment end, and a label behind a list marker
// written in the comment by reading that line on its own, since the note
// reading sees no list item inside a comment.

describe("a list-item definition inside a %% comment", () => {
    it("a bullet item's label inside the comment is named", () => {
        // Before the fix, [].
        expect(commentedDefinitionNames("Text[^x].\n\n%%\n- [^x]: hidden in item\n%%")).toEqual(["x"]);
    });

    it("an ordered item's label inside the comment is named", () => {
        // Before the fix, [].
        expect(commentedDefinitionNames("Text[^x].\n\n%%\n1. [^x]: hidden in ordered item\n%%")).toEqual(["x"]);
    });
});
