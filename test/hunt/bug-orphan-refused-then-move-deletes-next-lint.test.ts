import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { orphanedFootnoteDefinitionNames, removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// BUG (annoyance): with "Delete orphaned definitions" on, an orphaned
// definition the lint rightly leaves alone is deleted by the next lint,
// after the same lint's move took away the reason it was left.
//
// What the user would see: "a[^b]", then "[^b]: def b", then a quoted
// "> [^q]: orphan q" that nothing references, then an indented "    more".
// The first save moves [^b]'s definition to the bottom and leaves [^q]'s;
// the alert after it names nothing. The second save, with nothing typed in
// between, deletes "> [^q]: orphan q". Since a lint of the text the last
// lint produced is skipped (lintNote's shortcut), that second save says
// "No linting needed." until the note is edited, and the deletion waits
// for the next lint after an edit.
//
// An "orphaned" definition is one that nothing references.
//
// Hunt 2026-10-06, cycle 4, lens lint. Cluster L5.
//
// Origin: pre-existing.
//
// Source of truth: lintNote's doc in src/linting/linter.ts ("The lint is
// meant to settle a note in one run"); the orphan alert, which names every
// orphan the lint leaves in place (ADR 0002).
//
// Cause: the orphan rule refuses to cut "[^q]" while "[^b]" sits right
// above it, because the indented "more" under it would then join [^b]'s
// definition as its next line. The move to the bottom then takes [^b]
// away, so the cut is safe; but the linter's repeat loop (64e7e6f) runs
// the orphan rule again only after a deletion, never after the move.

const doc = "a[^b]\n\n[^b]: def b\n> [^q]: orphan q\n    more";
const options = { removeOrphanedDefinitions: true };

describe("move-to-bottom unblocks an orphan cut the same lint refused", () => {
    it("control: the orphan rule alone refuses to cut [^q] in the note as it is", () => {
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe(doc);
        expect(orphanedFootnoteDefinitionNames(doc)).toEqual(["q"]);
    });

    // Now: the first lint gives "a[^b]", "", "> [^q]: orphan q",
    // "    more", "", "[^b]: def b"; the second deletes "> [^q]: orphan q".
    it.fails("the lint with Delete orphaned definitions on is idempotent", () => {
        const once = lintFootnotes(doc, options);
        expect(lintFootnotes(once, options)).toBe(once);
    });

    // After one lint, either [^q] is gone, or the orphan rule still refuses
    // it in the note as it now is, so the alert is right to name it. Now:
    // [^q] is left, and the orphan rule would cut it.
    it.fails("after one lint, either [^q] is gone or the orphan rule still refuses it (so the alert names it)", () => {
        const once = lintFootnotes(doc, options);
        const left = orphanedFootnoteDefinitionNames(once);
        if (left.length === 0) return;
        expect(removeOrphanedFootnoteDefinitions(once)).toBe(once);
    });
});
