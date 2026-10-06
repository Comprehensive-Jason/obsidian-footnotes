// Imported from the glm-cycle-9 hunt of 2026-09-16 (OpenCode worktree); all pins flipped green 2026-09-16 after the fix.
// RESOLVED 2026-09-16 (GLM hunt cycle 9, probed in Reading view: footnote b still renders when only the closer-line definition's body cites it). The orphan chain never runs through a definition the rule never cuts.
// Imported from the GLM 5.3 Flash cycle 13 hunt of 2026-09-16 (OpenCode worktree); 3 of 4 tests carry it.fails: all marked by this hunt.
import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import {
    orphanedFootnoteDefinitionNames,
    removeOrphanedFootnoteDefinitions,
} from "../../src/linting/rules/remove-orphaned-definitions";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";

// BUG (GLM hunt cycle 13, 2026-09-16): the orphaned-definitions rule
// follows deletion chains through definitions that are NEVER CUT. A label
// right after a "%%" block comment's closer ("%% [^a]: sees [^b]") is a
// real definition whose line holds the closer, so it is reported but never
// removed (holdsCloser, pinned: such orphans are never cut). The chain
// walk does not know that: when nothing references "a", it marks "a" dead
// and decrements the reference its body makes to "b", so "[^b]: b body" -
// whose only reference sits in the surviving closer line - is deleted.
//
// What the user sees: in Reading view, footnote "b" is still rendered (its
// reference lives in the text after the closer, which Obsidian shows),
// yet its definition is gone: a live reference the lint itself orphaned.
// The linter's own promise says this cannot happen: "Deleting an orphaned
// definition can never orphan a live reference, because a reference
// pointing at a definition is exactly what keeps that definition alive"
// (src/linting/linter.ts). And the duplicate-safe shape of the same
// ruling - "neither is ever cut or merged" for closer-line copies - is
// honored by the merge rule but not by the chain walk here.
//
// The orphaned-definition alert happens to name only "a" (its contract
// does not follow chains), so the deletion of "b" is silent: the user
// opted into "delete definitions nothing references" and lost one that
// something in the note does reference. ADR-0002: lint never eats text
// the user did not opt into losing.
//
// Source of truth: linter.ts's conservation promise + ADR-0002 +
// the recorded Reading-view ground truth that a label after a "%%" closer
// is a live definition whose body text is live (Jason's verification
// 2026-09-15, sheet 11).
//
// Settings involved: `Delete orphaned definitions` ON; the same shared
// walk also runs under Reindex with `Keep orphaned definitions` off.

const doc = [
    "%%",
    "hidden",
    "%% [^a]: sees [^b]",
    "",
    "[^b]: b body",
    "",
    "tail",
].join("\n");

const deleteOrphans: LintOptions = {
    fixPunctuation: false,
    fixLazyDefinitions: false,
    moveDefinitionsToBottom: false,
    reindex: false,
    reindexOptions: { renumberNamedFootnotes: false },
    removeOrphanedReferences: false,
    removeOrphanedDefinitions: true,
    mergeDuplicateDefinitions: false,
    orphanSafePrefix: "",
    applyNotePrefix: false,
    sectionHeading: "",
};

describe("a never-cut %%-closer definition must not drag its cited definition into the chain", () => {
    it("Delete orphaned definitions keeps [^b]: b body, which the surviving body cites", () => {
        const out = removeOrphanedFootnoteDefinitions(doc);
        expect(out).toContain("[^b]: b body");
    });

    it("the full lint keeps it too", () => {
        expect(lintFootnotes(doc, deleteOrphans)).toContain("[^b]: b body");
    });

    it("the orphan rule followed by reindex keeps it as well", () => {
        const out = reindexFootnotes(removeOrphanedFootnoteDefinitions(doc));
        expect(out).toContain("[^b]: b body");
    });

    it("control: a genuinely unreferenced closer-line orphan is still never cut", () => {
        // the holdsCloser refusal itself stands; only the chain through it
        // is wrong
        const plain = "%%\nhidden\n%% [^a]: def\n\ntail";
        expect(removeOrphanedFootnoteDefinitions(plain)).toBe(plain);
        // and the alert names "a", by its no-chains contract
        expect(orphanedFootnoteDefinitionNames(doc)).toEqual(["a"]);
    });
});
