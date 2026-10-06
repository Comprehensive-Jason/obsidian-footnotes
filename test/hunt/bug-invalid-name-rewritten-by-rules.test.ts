import { describe, expect, it } from "vitest";

import { applyFootnotePrefix } from "../../src/linting/rules/apply-footnote-prefix";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";

// Scenario: a name with a space in it is not a footnote to Obsidian, it is
// ordinary prose, but the lint rules still treat it as one and rewrite or
// delete it.
//
// What the user would see: a line of their own writing such as
// "[^my note]: The full citation goes here." vanishes from the note when
// lint runs with "Delete orphaned definitions" switched on, and a sentence
// like "Alpha[^ 1]. Bravo." has its punctuation shuffled into
// "Alpha.[^ 1] Bravo." on the default settings. Nothing warns them; the
// text is simply gone or moved.
//
// Hunt: 2026-09-13. Lens: grammar.
//
// Source of truth:
//  - micromark-extension-gfm-footnote 2.1.0 rejects a space or a tab inside
//    a label outright. Checked against the copy in node_modules: "see [^ 1]"
//    renders as an ordinary link, and "[^1 ]: prose" renders as a paragraph,
//    not as a definition.
//  - src/parsing/footnote-grammar.ts says the same thing in its own note:
//    Obsidian will not render a footnote whose name holds whitespace
//    (Jason, 2026-08-10).
//  - The plugin already has this policy for the sibling rule. In
//    remove-orphaned-references.ts: "Deleting [^my note] would destroy
//    ordinary prose, so those stay", pinned in
//    test/orphaned-references.test.ts.
//  - ADR-0002.
//
// Note on the reference pattern itself: the permissive regex that matches
// these shapes is deliberate, so the invalid-name alert can see them and
// warn. Seeing them is fine. Rewriting them is the bug.

describe("a whitespace name is prose, and no rule may rewrite it", () => {
    it("deleting orphaned definitions does not eat a [^1 ]: prose line", () => {
        const before = "Alpha.\n\n[^1 ]: prose that only looks like a label\n";
        expect(reindexFootnotes(removeOrphanedFootnoteDefinitions(before))).toContain(
            "prose that only looks like a label",
        );
    });

    it("deleting orphaned definitions does not eat a real citation line", () => {
        // The shape a person actually writes. Today the whole line goes and
        // the note comes back as just "Alpha.\n".
        const before = "Alpha.\n\n[^my note]: The full citation goes here.\n";
        expect(removeOrphanedFootnoteDefinitions(before)).toBe(before);
    });

    it("reindex does not renumber a whitespace name into a live footnote", () => {
        // With "renumber named footnotes" on, the prose "[^ 1]" is rewritten
        // to "[^1]", which turns a piece of writing into a real reference.
        const before = "Alpha[^ 1] and bravo[^2].\n\n[^2]: two\n";
        expect(reindexFootnotes(before, { renumberNamedFootnotes: true })).toContain("[^ 1]");
    });

    it("apply-prefix does not stamp a prefix onto a whitespace name", () => {
        // Today this produces "[^2. 1]", a name that is still not a footnote
        // and no longer what the user typed.
        const before = "Alpha[^ 1] here.\n";
        expect(applyFootnotePrefix(before, "2.")).toBe(before);
    });

    it("the punctuation rule does not move prose around a whitespace name", () => {
        // This one runs on the default settings, so it is the easiest of the
        // set for a user to hit by accident.
        const before = "Alpha[^ 1]. Bravo.\n";
        expect(footnoteAfterPunctuation(before)).toBe(before);
    });

    it("control: deleting orphaned references already leaves [^my note] alone", () => {
        const before = "Prose with [^my note] in it, nothing else.\n";
        expect(removeOrphanedFootnoteReferences(before)).toBe(before);
    });
});
