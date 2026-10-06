// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 2 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";

// A name with a backtick in it ("[^tick`a]") is not a footnote to Obsidian
// at all - it cannot render (the manual tricky-footnote-names tests). The lint's own policy for
// such names, in lint-alerts.ts, is: "a name the user typed by hand ...
// cannot be fixed automatically: there is no telling which name they
// meant. So the lint reports it instead" (the invalid-name alert). The
// orphaned-REFERENCE rule honors that: isOrphan refuses to delete a name
// isValidFootnoteName rejects, because "deleting it would destroy ordinary
// prose". Reindex already honors it for WHITESPACE names too: they take
// no slot in the renumbering order and are never rewritten
// (bug-reindex-whitespace-name-slot).
//
// But with `Renumber named footnotes` ON, reindex renames a backticked
// name like any other: "[^tick`a]" becomes "[^1]". Two things go wrong.
//
// One: the rename is exactly the automatic "fix" the alert policy says the
// lint must not do, and it happens SILENTLY - the invalid-name alert runs
// on the post-lint text, where the backticked name no longer exists, so it
// never fires (ADR-0002, never-silent).
//
// Two: the renamed reference is now a perfectly ordinary orphan, so a
// pipeline that also has `Delete orphaned references` ON eats it on the
// NEXT lint. "Lint twice equals lint once" breaks: pass 1 renames, pass 2
// deletes. With lint-on-save the user's sentence loses its footnote text
// on their second save, with no alert ever naming it.
//
// What the user sees: "[^tick`a] backtick" becomes "[^1] backtick" on the
// first lint (no warning), then "backtick" on the second (no warning).
//
// Source of truth: lint-alerts.ts's own stated policy (invalid names are
// reported, never auto-fixed) + the idempotence invariant pinned in
// test/properties.test.ts ("lint is idempotent for every document and
// option combo") + the manual tricky-footnote-names tests' ground truth that a backticked name cannot
// render.
//
// Settings involved: `Renumber named footnotes` ON (non-default) for the
// rename; `Delete orphaned references` ON (non-default) for the deletion.

const options: LintOptions = {
    fixPunctuation: false,
    fixLazyDefinitions: false,
    moveDefinitionsToBottom: false,
    reindex: true,
    reindexOptions: { renumberNamedFootnotes: true },
    removeOrphanedReferences: true,
    removeOrphanedDefinitions: false,
    mergeDuplicateDefinitions: false,
    orphanSafePrefix: "",
    applyNotePrefix: false,
    sectionHeading: "",
};

const doc = "[^tick`a] backtick\n\npara text[^2] here";

describe("reindex with `Renumber named footnotes` renames a backticked (unrenderable) name", () => {
    it("renames the backticked name like any named footnote: it renders (Reading view, 2026-09-16)", () => {
        // The pin's premise was wrong: "[^tick`a]" renders as a footnote in
        // Reading view (probed), so it is a real name and reindex may
        // renumber it. The bug behind the pin was in the orphan rule, which
        // exempted backtick names from deletion and so let the renamed
        // orphan survive one lint and die the next; the rule now exempts
        // whitespace names only.
        expect(reindexFootnotes(doc, { renumberNamedFootnotes: true })).toBe("[^1] backtick\n\npara text[^2] here");
    });

    it("lint twice equals lint once (the second pass must not eat the renamed reference)", () => {
        const once = lintFootnotes(doc, options);
        expect(lintFootnotes(once, options)).toBe(once);
    });

    it("control: a VALID named footnote is renumbered by the same option", () => {
        expect(reindexFootnotes("[^real] backtick\n\n[^real]: def", { renumberNamedFootnotes: true })).toBe(
            "[^1] backtick\n\n[^1]: def",
        );
    });

    it("control: a whitespace name is already left alone (the parity target)", () => {
        expect(reindexFootnotes("[^bad name] x", { renumberNamedFootnotes: true })).toBe("[^bad name] x");
    });

    it("control: without `Renumber named footnotes` the backticked name is left alone today (the numbered footnote still renumbers)", () => {
        expect(reindexFootnotes(doc)).toBe("[^tick`a] backtick\n\npara text[^1] here");
    });
});
