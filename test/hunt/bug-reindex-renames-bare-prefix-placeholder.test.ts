// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { countEmptyFootnoteReferences } from "../../src/linting/lint-alerts";

// A bare-prefix placeholder ("[^3.]" in a note whose prefix is "3.") is a
// footnote the user is still naming - "an in-progress footnote owned by
// the user's typing, never deleted out from under them" (CONTEXT.md), and
// the unnamed-reference alert counts it as unfilled exactly like "[^]"
// (the manual lint-alerts tests). Orphan deletion already leaves it alone (orphanSafePrefix).
// Reindex does not: with `Renumber named footnotes` ON, "3." is a NAME
// like any other, so the placeholder is renumbered to "[^3.1]" - the
// user never typed the "1", the placeholder is gone, and the alert that
// should keep reminding them about it falls silent on the post-lint text.
//
// What the user sees: they planted "[^3.]" to name in a moment, pressed
// save with lint-on-save, and the placeholder silently became "[^3.1]";
// the alert that was supposed to remind them it is unfinished never
// fires again. When they come back and type "smith" they get "[^3.1smith]"
// - a footnote, but not the one they meant, and nobody told them.
//
// Source of truth: CONTEXT.md's placeholder contract + the manual lint-alerts tests'
// "counts as unfilled exactly like [^]" (the alert must keep speaking,
// which it cannot once the placeholder is renamed away) + the
// orphanSafePrefix precedent (deletion already exempts it; renumbering
// is the same class of touch).
//
// Settings involved: `Reindex` ON (default) + `Renumber named footnotes`
// ON + a per-note prefix.

describe("reindex and the bare-prefix placeholder", () => {
    it("the placeholder keeps its bare name (never renumbered)", () => {
        const doc = "text[^3.] and[^1] here\n\n[^1]: one";
        expect(reindexFootnotes(doc, { renumberNamedFootnotes: true, prefix: "3." })).toBe(doc);
    });

    it("the unnamed alert can still see the placeholder after the lint", () => {
        const doc = "text[^3.] and[^1] here\n\n[^1]: one";
        const out = reindexFootnotes(doc, { renumberNamedFootnotes: true, prefix: "3." });
        expect(countEmptyFootnoteReferences(out, "3.")).toBe(1);
    });

    it("control: renumberNamed OFF leaves the placeholder alone (the default)", () => {
        const doc = "text[^3.] and[^1] here\n\n[^1]: one";
        expect(reindexFootnotes(doc, { prefix: "3." })).toBe(doc);
    });

    it("control: a FILLED prefixed name renumbers normally", () => {
        const doc = "text[^3.9] here\n\n[^3.9]: nine";
        expect(reindexFootnotes(doc, { renumberNamedFootnotes: true, prefix: "3." })).toBe(
            "text[^3.1] here\n\n[^3.1]: nine",
        );
    });
});
