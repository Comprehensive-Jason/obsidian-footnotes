// Imported from the glm-cycle-10 hunt of 2026-09-16 (OpenCode worktree); heading, bullet, and 1. confirmed and fixed, rule and 2. refuted, 2026-09-16.
// RESOLVED 2026-09-16 (GLM hunt cycle 10, probed in Reading view): a quoted heading, bullet, or "1." item directly under a quoted definition is a block of its own inside the quote; a quoted "---" under the label line makes the label a heading (as at column 0) and a "2. item" carries the footnote on. quotedDefinitionEnd now makes the column-0 walker's stops.
// GLM hunt cycle 10, 2026-09-16.
//
// Scenario: a block of its own sits directly under a QUOTED definition's
// label line, inside the same quote:
//
//     > [^2]: body
//     > # Heading
//     (or "> - item", "> ---", "> 2. item")
//
// What Reading view shows: the heading (the list item, the rule) is a
// block of its own INSIDE the quote, not the footnote's body. micromark
// with the GFM footnote extension renders it outside the definition, and
// the plugin's own column-0 walker agrees for the identical unquoted
// text: findDefinitionBlocks stops at a heading, a rule, or a list item
// (lazyContinuation rejects them; the cycle-9 Reading-view probe pinned
// "1. and - start lists" under a definition). The quoted walker's own
// doc comment says the extent runs through "a lazy continuation, or an
// indented one" at the same depth.
//
// quotedDefinitionEnd does none of that: its main loop absorbs EVERY
// non-blank quoted line at the same depth, headings, rules, and list
// items included. Only a setext underline (cycle 5) gets the stop.
//
// What the user sees: with `Delete orphaned definitions` ON, the quoted
// footnote's cut takes the heading (the list item, the rule) with it and
// the quote loses a block the user wrote (ADR-0002: lint never eats user
// text). The same wrong extent makes the press guards call the heading
// line "inside a definition" (quotedDefinitionLabelAbove), so a press on
// it is refused as nesting.
//
// Source of truth: micromark + gfm-footnote (heading/list/rule render
// outside the quoted definition) + the cycle-9 Reading-view probe for the
// column-0 twin + findDefinitionBlocks' own block-ender contract, which
// the quoted walker must mirror.
//
// Settings involved: `Delete orphaned definitions` ON for the cut; the
// walker disagreement itself needs no setting.

import { readNote } from "../../src/parsing/note-reading";
import { describe, expect, it } from "vitest";

import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

describe("a block of its own directly under a quoted definition's label", () => {
    const cases: [string, string][] = [
        ["ATX heading", "> # Heading"],
        ["bullet list item", "> - item"],
        ["ordered list item numbered 1", "> 1. item"],
    ];

    for (const [name, line] of cases) {
        it(`stops before a ${name} inside the quote`, () => {
            const lines = ["> [^2]: body", line, "", "text[^1]", "", "[^1]: d"];
            const starts = readNote(lines).labelLines;
            expect(starts[0]).toBe(true);
            expect((readNote(lines).labelOn(0)?.end ?? 0)).toBe(0);
        });
    }

    it("REFUTED for a rule: a quoted \"---\" under the label line makes the label a heading, as at column 0", () => {
        // Reading view renders "2: body" as a heading and no footnote
        // (probed 2026-09-16), so the label starts nothing there
        const lines = ["> [^2]: body", "> ---", "", "text[^1]", "", "[^1]: d"];
        const starts = readNote(lines).labelLines;
        expect(starts[0]).toBe(false);
    });

    it("REFUTED for \"2. item\": an ordered item not numbered 1 carries the quoted footnote on", () => {
        // one footnote "body 2. item" (probed 2026-09-16), as at column 0
        const lines = ["> [^2]: body", "> 2. item", "", "text[^1]", "", "[^1]: d"];
        expect(readNote(lines).labelOn(0)?.end).toBe(1);
    });

    it("orphan deletion keeps the heading the quote shows", () => {
        const doc = "> [^2]: body\n> # Heading\n\ntext[^1]\n\n[^1]: d";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe(
            "> # Heading\n\ntext[^1]\n\n[^1]: d",
        );
    });

    it("orphan deletion keeps the list item the quote shows", () => {
        const doc = "> [^2]: body\n> - item\n\ntext[^1]\n\n[^1]: d";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe(
            "> - item\n\ntext[^1]\n\n[^1]: d",
        );
    });

    it("control: the column-0 twin already keeps the heading", () => {
        const doc = "[^2]: body\n# Heading\n\ntext[^1]\n\n[^1]: d";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe(
            "# Heading\n\ntext[^1]\n\n[^1]: d",
        );
    });

    it("control: a plain quoted line still continues the definition", () => {
        const lines = ["> [^2]: body", "> cont"];
        expect(readNote(lines).labelOn(0)?.end).toBe(1);
    });
});
