import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";

// BUG (wrong output): cutting an orphaned reference out of a run of
// references in front of a colon leaves a line shaped like a definition,
// and the next lint turns it into a second definition.
//
// What the user would see: under a line of prose sits
// "[^8][^9]: x", which Reading view shows as part of the paragraph
// (footnote 8, then "[^9]: x" as text, since nothing defines [^9]). With
// Delete orphaned references on, the lint cuts "[^9]" and leaves
// "[^8]: x": a lazy label (a line under prose that looks like a definition
// but is read as paragraph text). The next lint's fix for lazy labels
// adds a blank line above it, which makes it a real second definition of
// footnote 8. Obsidian shows only one definition, so the prose "x"
// vanishes from the page; with Merge duplicate definitions on, "x" becomes
// the footnote's first line and the real text its continuation. This
// shows with placement "before" or "don't move", or with the punctuation
// rule off; under "after" the punctuation rule happens to move the run
// past the colon first.
//
// Hunt 2026-10-02, round 2, lens properties. Cluster P4.
//
// Source of truth: the lint's idempotence promise (linter.ts: "a second
// run of the lint finds no duplicates left, which is what keeps running
// the lint twice from changing anything the second time";
// test/properties.test.ts, "lint is idempotent for every document and
// option combo"), and the orphan rule's own contract: its readsDifferently
// docstring names "turn that label into a real definition" as a reason to
// refuse a cut.

describe("an orphan cut that leaves a lazy label behind", () => {
    it.fails("the rule alone does not manufacture a lazy label", () => {
        const out = removeOrphanedFootnoteReferences("a[^8]\n\nprose\n[^8][^9]: x\n\n[^8]: d");
        // Today: "prose\n[^8]: x" is left. Either refuse the cut, or leave a line that is not label-shaped.
        expect(out).not.toContain("prose\n[^8]: x");
    });

    it.fails("lint is idempotent (placement none, Delete orphaned references on)", () => {
        const doc = "a[^8] b[^7]\n\nprose line\n[^8][^9]: x\n\n[^8]: eight\n[^7]: seven";
        const options: LintOptions = { placement: "none", removeOrphanedReferences: true };
        const once = lintFootnotes(doc, options);
        // Today lint 2 adds a blank line above the stray "[^1]: x", making it a second definition.
        expect(lintFootnotes(once, options)).toBe(once);
    });
});
