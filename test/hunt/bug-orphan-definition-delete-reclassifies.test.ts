// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// The orphaned-REFERENCE rule refuses a deletion that would change how
// Obsidian reads the lines around it: "a deletion that changes whether
// ANY other line counts as protected is refused outright. The orphaned
// references stay, for the user to sort out." (remove-orphaned-references.ts,
// plus the prose-label twin of the guard). The orphaned-DEFINITION rule
// has no such guard: it cuts the block and walks away.
//
// Here the cut makes the line BELOW a lazy label land directly under a
// setext underline, so the next lint reads that lazy label as a REAL
// definition - an orphaned one, which the same setting then deletes. The
// user's "[^3]: y" survives lint 1 (it was lazy prose, never a
// definition) and is GONE after lint 2, without any alert naming it: the
// orphan alert stays off while the deletion toggle is on, and the lazy
// alert saw a definition by then.
//
// What the user sees: with `Delete orphaned definitions` ON, running the
// lint twice deletes a definition the first run left behind, so lint-on-
// save eats it on their second save. "Lint twice equals lint once" - the
// invariant the whole pipeline is built around - breaks.
//
// The chain in detail: [^4]'s orphaned block owns the math region its
// body opens (findDefinitionBlocks), so deleting it removes the "$$ tail"
// line too; "[^3]: y" then sits directly under the "===" underline, and a
// label under a setext underline is a definition (blockEnder). Pass 2
// finds it orphaned and cuts it.
//
// Source of truth: the idempotence invariant pinned in
// test/properties.test.ts ("lint is idempotent for every document and
// option combo") + the reclassification-guard precedent in
// remove-orphaned-references.ts.
//
// Settings involved: `Delete orphaned definitions` ON (non-default); the
// lazy-fix and move rules OFF to isolate the mechanism.

const options: LintOptions = {
    fixPunctuation: false,
    fixLazyDefinitions: false,
    moveDefinitionsToBottom: false,
    reindex: false,
    removeOrphanedReferences: false,
    removeOrphanedDefinitions: true,
    mergeDuplicateDefinitions: false,
    orphanSafePrefix: "",
    applyNotePrefix: false,
    sectionHeading: "",
};

const doc = "para\n===\n[^4]: x $$\n$$ tail\n[^3]: y";

describe("orphaned-definition deletion reclassifying the lines below it", () => {
    it("lint twice equals lint once", () => {
        const once = lintFootnotes(doc, options);
        expect(lintFootnotes(once, options)).toBe(once);
    });

    // Corrected in step 2 of the runtime swap (2026-10-03): Obsidian reads
    // "$$ tail" as a display math block of its own, which ends [^4]'s
    // definition (rules M2 and E1, docs/obsidian-reading-rules.md) and runs
    // to the end of the note, "[^3]: y" inside it. So [^4] is its label
    // line alone, cutting it changes how no other line reads, and the cut
    // goes through; the scanner had [^4] owning the math lines and refused.
    // The invariant this pin is about, lint twice equals lint once, holds.
    it("deleting [^4] takes only its own line and changes how no other line reads", () => {
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe("para\n===\n$$ tail\n[^3]: y");
    });

    it("control: without the lazy label below, the orphaned block deletes fine", () => {
        expect(removeOrphanedFootnoteDefinitions("para\n===\n[^4]: x $$\n$$ tail")).toBe("para\n===");
    });

    it("control: with `Delete orphaned definitions` OFF the note is untouched", () => {
        expect(lintFootnotes(doc, { ...options, removeOrphanedDefinitions: false })).toBe(doc);
    });
});
