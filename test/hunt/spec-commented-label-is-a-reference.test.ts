import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";

import { planFootnoteRename } from "../../src/commands/rename-footnote";
import { simulateChanges } from "../../src/editor/insertion-liveness";
import { definitionsInsideTableNames } from "../../src/linting/lint-alerts";
import { commentedDefinitionNames } from "../../src/linting/rules/remove-orphaned-references";
import { applyFootnotePrefix } from "../../src/linting/rules/apply-footnote-prefix";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { orphanedFootnoteDefinitionNames } from "../../src/linting/rules/remove-orphaned-definitions";
import { orphanedFootnoteReferenceNames } from "../../src/linting/rules/remove-orphaned-references";

// Jason's ruling A1 (2026-09-15), from Obsidian's Reading view: a
// definition label inside a %% block comment is dead as a DEFINITION but
// its own "[^k]" is a live REFERENCE. The shape "one[^a] two[^k] three[^b]"
// with a hidden "[^k]: copy" and a real "[^k]: real K" numbers k as 2 and
// gives the real definition TWO back-arrows. So the plugin matches
// Obsidian: the hidden reference counts for numbering, orphaned definitions,
// and rename, and the rules edit it like any other reference. What the user
// gets on top is a lint alert naming the definition that sits inside a
// comment, since Obsidian will never show it there.
//
// This file replaces three sweep pins written for the opposite reading
// (bug-commented-label-counted-as-reference, bug-name-rename-edits-
// comment-block, spec-commented-label-open-questions).

describe("a commented label's own reference is live", () => {
    // Jason's ruling, 2026-11-05: with no real definition it is no orphan to
    // report or delete, as a lazy label is not, because the user wrote the
    // definition. The alert naming the commented definition speaks for it (pin
    // spec-lint-orphan-cut-commented-label). It was an orphaned reference
    // until then.
    it("with no real definition it is left to the commented-definition alert, not named as an orphaned reference", () => {
        const doc = "see[^a]\n\n%%\n[^k]: only here\n%%\n\n[^a]: A";
        expect(orphanedFootnoteReferenceNames(doc)).toEqual([]);
        expect(commentedDefinitionNames(doc)).toEqual(["k"]);
    });

    it("it keeps a real definition alive that nothing else references", () => {
        const doc = "prose\n\n%%\n[^dead]: hidden copy\n%%\n\n[^dead]: the real one";
        expect(orphanedFootnoteDefinitionNames(doc)).toEqual([]);
    });

    it("reindex numbers it in appearance order, like Obsidian", () => {
        expect(reindexFootnotes("a[^1] b[^2]\n\n%%\n[^9]: dead\n%%\n\n[^1]: A\n[^2]: B")).toBe(
            "a[^1] b[^2]\n\n%%\n[^3]: dead\n%%\n\n[^1]: A\n[^2]: B",
        );
    });

    it("apply-prefix brings it into the note's namespace with the others", () => {
        expect(applyFootnotePrefix("a[^1]\n\n%%\n[^1]: copy\n%%\n\n[^1]: A", "p.")).toBe(
            "a[^p.1]\n\n%%\n[^p.1]: copy\n%%\n\n[^p.1]: A",
        );
    });

    it("a rename rewrites the hidden copy together with the live pair (Jason verified live, 2026-09-15)", () => {
        const lines = ["one[^k] here", "", "%%", "[^k]: hidden copy", "%%", "", "[^k]: real K"];
        const plan = planFootnoteRename(fakeEditor(lines, { wholeDoc: true }), "k", "kay");
        expect(plan.kind).toBe("renamed");
        if (plan.kind !== "renamed") throw new Error("unreachable");
        expect(simulateChanges(lines, plan.changes)).toEqual([
            "one[^kay] here",
            "",
            "%%",
            "[^kay]: hidden copy",
            "%%",
            "",
            "[^kay]: real K",
        ]);
    });

    it("a name that exists only as a commented label is a collision, since its reference is live", () => {
        const lines = ["see[^x]", "", "%%", "[^y]: hidden", "%%", "", "[^x]: X"];
        expect(planFootnoteRename(fakeEditor(lines, { wholeDoc: true }), "x", "y").kind).toBe("collision");
    });
});

describe("the two alerts the rulings added", () => {
    it("names a definition that sits inside a %% block comment (ruling A1)", () => {
        expect(commentedDefinitionNames("see[^k]\n\n%%\n[^k]: hidden\n%%\n\n[^k]: real")).toEqual(["k"]);
        expect(commentedDefinitionNames("see[^k]\n\n%% inline %%\n\n[^k]: real")).toEqual([]);
    });

    it("names a definition that sits inside a table, rows continuing after it (ruling A2)", () => {
        expect(definitionsInsideTableNames("| a | b |\n| - | - |\n| c | d |\n[^1]: x\n| e | f |\n\nref[^1]")).toEqual(["1"]);
        expect(definitionsInsideTableNames("| a | b |\n| - | - |\n| c | d |\n[^1]: x\n\nref[^1]")).toEqual([]);
        expect(definitionsInsideTableNames("prose\n\n[^1]: x\n| e | f |")).toEqual([]);
    });
});
