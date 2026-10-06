// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 4 of 4 tests were red there and carry it.fails.
import { describe, expect, it } from "vitest";

import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { readNote } from "../../src/parsing/note-reading";

// What a user sees: a footnote named "a<!--b" renders and binds in the note
// (micromark, the project's own oracle parser, carves the "[^...]" label
// BEFORE HTML tokenization: "see[^a<!--b]" parses as footnoteReference(a<!--b)
// and its label as footnoteDefinition(a<!--b) - the same label-first rule the
// code-span-name pin cites). But the lint's masker has no
// inside-reference-shape guard on its "<!--" branch (the "$" and backtick
// branches both have one), so the unclosed opener masks the reference to end
// of line and turns every following line into a phantom comment region.
// Consequences, all silent: reindex with orphan deletion DELETES THE WHOLE
// DOCUMENT's footnote (definition judged orphaned, its reference invisible),
// renumber-named renames the definition but not the reference (pair severed),
// and move-to-bottom refuses the note forever (phantom unclosed comment).
//
// A masked-name identity mutation the pins did not cover: bug-masked-name-identity
// pins a COMPLETE comment span inside a name ("[^a<!-- -->b]"); an UNCLOSED
// opener inside the name is the un-covered neighbor.

describe("an unclosed comment opener inside a footnote name", () => {
    it("the opener inside the name hides nothing from the number scan", () => {
        // "see[^a<!--b]" is a live NAMED reference to micromark, and a
        // named footnote reserves no number (the scan's own contract), so
        // the next number is 1; the pin as imported expected 2, which no
        // reading of the note supports (rewritten 2026-09-16). What the
        // opener must not do is swallow the rest of the line: a numbered
        // reference after it still counts.
        expect(computeNextFootnoteNumber("see[^a<!--b] here.")).toBe(1);
        expect(computeNextFootnoteNumber("see[^a<!--b] and [^3] here.")).toBe(4);
    });

    it("drop-orphans does not delete a definition whose reference carries the opener", () => {
        const doc = "[^a<!--b]: body\n\nsee[^a<!--b] here.";
        expect(reindexFootnotes(removeOrphanedFootnoteDefinitions(doc))).toBe(doc);
    });

    it("renumber-named renames reference and definition together", () => {
        const doc = "[^a<!--b]: body\n\nsee[^a<!--b] here.";
        expect(reindexFootnotes(doc, { renumberNamedFootnotes: true })).toBe(
            "[^1]: body\n\nsee[^1] here.",
        );
    });

    it("no phantom comment region: lines after the reference stay live", () => {
        // the phantom unclosed comment protects the rest of the note, which
        // is also what paralyses move-to-bottom (endsProtected) on it
        const doc = "see[^a<!--b] here.\n\ntail\n\n[^a<!--b]: body";
        expect(readNote(doc.split("\n")).protectedLines).toEqual([
            false,
            false,
            false,
            false,
            false,
        ]);
    });
});
