// Imported from the glm-cycle-11 hunt of 2026-09-16 (OpenCode worktree); all pins flipped green 2026-09-16 after the fix.
// RESOLVED 2026-09-16 (GLM hunt cycle 11): the kept-line comparison steps over a blank line the residue guards put in, so the cut that leaves a "---" at the note's front is allowed on the first lint.
// GLM 5.3 Flash cycle 11 hunt of 2026-09-16 (OpenCode worktree glm-cycle-11). 3 of 4 tests carry it.fails; the controls do not.
import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { orphanedFootnoteDefinitionNames } from "../../src/linting/rules/remove-orphaned-definitions";

// BUG: an orphaned definition whose cut leaves a "---" (or "===") rule line
// directly at the cut's edge is refused on the first lint for the wrong
// reason, and the second lint then performs the very same cut - lint twice
// is not lint once.
//
// The note "[^1]: body\n    cont\n---" holds an orphaned definition (nothing
// references [^1]; the "---" under its indented continuation is a thematic
// break, micromark: footnoteDefinition then thematicBreak). The cut of the
// definition's block leaves the rule at the very front of the note, and
// removeLineRanges' stranded-frontmatter guard fires: a bare "---" first is
// only provisionally a rule, so the guard prepends a blank line. The result
// ["", "---"] is exactly right - the rule reads the same either way - but
// linesReadDifferently then compares the kept lines against the result and
// sees out[0] = "" where the kept line was "---", a non-blank mismatch, and
// REFUSES the cut. The rule's own protective blank defeats its own
// kept-line comparison.
//
// So the first lint (with `Delete orphaned definitions` ON) leaves the
// orphan in place and instead gathers it below the rule (move-to-bottom,
// the manual lint-stability tests' layout), where the definition no longer touches the rule and
// the SAME cut is clean: the second lint deletes the orphan, the third says
// nothing. The manual lint-rules tests pin the contract this breaks: "run lint AGAIN
// (it must say 'No linting needed.')".
//
// What the user would see: with the delete toggle on, the first lint
// "Footnotes linted." moves the orphan under their horizontal rule, the
// second lint silently deletes it, and only a third lint goes quiet - two
// lints to settle a note.
//
// Source of truth: the rule's own refusal contract ("a deletion that changes
// how Obsidian reads a line it did not touch is refused" - the rule here
// changes NO line's reading, micromark: footnoteDefinition + thematicBreak
// before, "" + thematicBreak after) + the manual lint-rules tests' second-lint
// contract + the idempotence property the suite already pins.
//
// Settings involved: `Delete orphaned definitions` ON, `Move definitions to
// the bottom` ON (defaults).

const opts = {
    fixPunctuation: true,
    fixLazyDefinitions: true,
    moveDefinitionsToBottom: true,
    reindex: true,
    removeOrphanedReferences: false,
    removeOrphanedDefinitions: true,
    mergeDuplicateDefinitions: false,
};

describe("an orphaned definition whose cut leaves a rule at the cut's edge", () => {
    it("the rule's own cut is allowed: the residue reads the same", () => {
        // the cut leaves ["", "---"] - the guard's blank keeps the rule a
        // rule; nothing Obsidian reads changes, so the deletion goes through
        expect(removeOrphanedFootnoteDefinitions("[^1]: body\n    cont\n---")).toBe("\n---");
    });

    it("the full lint settles in one pass", () => {
        const doc = "[^1]: body\n    cont\n---";
        const once = lintFootnotes(doc, opts);
        expect(lintFootnotes(once, opts)).toBe(once);
    });

    it("control: the =-spelling has no residue guard, so its cut is clean at the front", () => {
        // removeLineRanges' setext guard needs a kept line above the
        // underline (out.length > 0) and its frontmatter guard is --- only,
        // so an "===" left at the very front cuts clean - the deferred
        // deletion is the --- spelling's alone
        const doc = "[^1]: body\n    cont\n===";
        const once = lintFootnotes(doc, opts);
        expect(lintFootnotes(once, opts)).toBe(once);
    });

    it("control: the alert names the orphan the first lint left", () => {
        // never-silent (ADR 2): while the cut is refused the alert speaks
        expect(orphanedFootnoteDefinitionNames("[^1]: body\n    cont\n---")).toEqual(["1"]);
    });

    it("control: an orphan whose cut is clean deletes in one pass", () => {
        expect(removeOrphanedFootnoteDefinitions("para\n\n[^1]: body\n\nrule\n---")).toBe("para\n\nrule\n---");
    });

    it("the first lint cuts the orphan and leaves the rule behind its guarding blank", () => {
        // before the fix: refused, moved under the rule, then deleted by
        // the second lint (fixed 2026-09-16)
        const doc = "[^1]: body\n    cont\n---";
        expect(lintFootnotes(doc, opts)).toBe("\n---");
    });
});
