import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// BUG (data loss with Delete orphaned definitions on): footnote placement
// "before" moves a reference back onto a backslash, which escapes it, and
// a second lint then deletes the footnote's text.
//
// What the user would see: the line reads "Version 2\.[^1] shipped", where
// "\." is an escaped full stop. The lint rewrites it to
// "Version 2\[^1]. shipped". Now the backslash escapes the reference's
// opening bracket, so "[^1]" shows as plain text and footnote 1 has no
// reference left. With Delete orphaned definitions on, the next lint
// deletes "[^1]: one" as an orphan, and the text is gone for good. The
// same happens with "\!".
//
// Hunt 2026-10-02, round 2, lens properties. Cluster P1.
//
// Source of truth: CommonMark 2.4 (a backslash before "[" makes the
// bracket literal, so "\[^1]" is plain text, as the plugin's own grammar
// and the punctuation rule's docstring agree: "an escaped \[^1] is literal
// prose"), and the rule's docstring ("Move every footnote reference to the
// side of the punctuation the placement setting says" - a move, never a
// deletion).
//
// Cause: the "before" walk steps back over the punctuation run without
// asking what sits in front of it, here the backslash that escaped it.

describe("placement 'before' moves a reference onto a backslash", () => {
    it.fails("an escaped period: the reference must stay live", () => {
        const out = footnoteAfterPunctuation("Version 2\\.[^1] shipped\n\n[^1]: one", "before");
        // Today: "Version 2\[^1]. shipped" - the backslash now escapes the reference.
        expect(out).not.toContain("\\[^1]");
    });

    it.fails("lint twice under 'before' with Delete orphaned definitions on keeps the definitions", () => {
        const options: LintOptions = { placement: "before", removeOrphanedDefinitions: true };
        const doc = "Version 2\\.[^1] shipped\\![^2] ok\n\n[^1]: one\n[^2]: two";
        const once = lintFootnotes(doc, options);
        // Today lint 1 escapes both references, and lint 2 deletes both
        // definitions as orphans, leaving "Version 2\[^1]. shipped\[^2]! ok".
        expect(lintFootnotes(once, options)).toContain("[^1]: one");
    });
});
