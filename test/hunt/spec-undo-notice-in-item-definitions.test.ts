import { describe, expect, it } from "vitest";

import { orphanedByUndo, stillOrphanedNames } from "../../src/editor/undo-orphan-notice";

// spec question: should the partial-undo notice know footnote definitions
// written inside a list item?
//
// What it does now: the notice speaks when an undo takes away a
// definition but leaves its reference behind. For a definition inside a
// list item ("- [^a]: def") it gets all three cases wrong:
// - an undo removes "- [^a]: def" while "See this[^a]." stays: no notice;
// - an undo removes a stray column-0 copy "[^a]: ..." while the list-item
//   definition stays: a notice claims [^a] lost its definition, which it
//   did not;
// - a redo brings the list-item definition back: the standing notice still
//   names [^a] instead of retiring itself.
// What a user might expect: the same notice as for a definition at the
// left margin (the control), since Obsidian renders a list-item definition
// as a footnote.
// Why it is a question and not a bug: Jason's ruling 1 (2026-09-20,
// commit f098798) recognised in-item definitions in a chosen list of
// readers (the orphan-reference alert and its deletion, navigation, the two
// renamers, the punctuation rule), and the undo notice is not on it. This
// is the same decision as round 3's E7
// (spec-lint-in-item-definitions-alerts-and-carry): should in-item
// definitions be modelled everywhere?
//
// Hunt 2026-10-02, round 4, lenses plumbing and root causes. Cluster U7
// (with the redo face from root 2).
//
// Source of truth: ruling 1, and the notice's own comments in
// src/editor/undo-orphan-notice.ts: it "speaks up for every partial-undo
// orphan", and orphanedByUndo reports "the names this undo orphaned:
// defined before it, not defined after it, and still referenced
// afterwards".

describe("spec question: the partial-undo notice and in-item definitions", () => {
    it.fails("names a reference an undo left without its list-item definition", () => {
        const before = ["See this[^a].", "", "- [^a]: a definition in a list"].join("\n");
        const after = ["See this[^a].", "", "- "].join("\n");
        // Today: [].
        expect(orphanedByUndo(before, after)).toEqual(["a"]);
    });

    it.fails("stays quiet when the footnote is still defined inside a list item", () => {
        // The undo took out a column-0 copy; the list-item definition stays.
        const before = ["See this[^a].", "", "- [^a]: in the list", "", "[^a]: a stray copy"].join("\n");
        const after = ["See this[^a].", "", "- [^a]: in the list"].join("\n");
        // Today: ["a"].
        expect(orphanedByUndo(before, after)).toEqual([]);
    });

    it.fails("the standing notice retires itself when a redo brings the in-item definition back", () => {
        // Today: ["a"]: with the definition back, the notice still claims [^a] is orphaned.
        expect(stillOrphanedNames("T[^a] here\n\n- [^a]: def", ["a"])).toEqual([]);
    });

    it("control: the column-0 twin is named", () => {
        expect(orphanedByUndo("T[^a] here\n\n[^a]: def", "T[^a] here\n\n")).toEqual(["a"]);
    });
});
