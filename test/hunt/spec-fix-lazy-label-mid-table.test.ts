import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { fixLazyDefinitions } from "../../src/linting/rules/fix-lazy-definitions";

// spec question: when a lazy label sits under a table row that is not the
// last one, should the fix-lazy rule insert its blank line there anyway, or
// do something that keeps the table whole?
//
// The shape: a table, and somewhere in the middle of it the user has typed
// "[^1]: x" on its own line, with more rows under it. The label is lazy (a
// label directly under a table row is paragraph text, not a definition), so
// the rule gives it a blank line above. GFM's table section says "The table
// is broken at the first empty line, or beginning of another block-level
// structure", so that blank line ends the table right there. Every row
// below it stops being a row and renders as literal text with pipes in it.
// Sitting directly under the promoted label, the leftover row is also read
// as that footnote's body.
//
// Reading one (fix it anyway, as today): the rule's job is to make lazy
// labels into definitions, and it does. The user typed a label in the
// middle of a table, which is already a strange thing to have; the blank
// line is the documented fix everywhere else.
//
// Reading two (keep the table whole): the note's table is content the user
// cares about and the plugin has no business cutting it in half. ADR-0002
// says a fix that destroys content is alerted rather than applied. Three
// remedies are on the table for Jason to pick between:
//   1. Alert instead of fixing whenever the lazy label sits above a row
//      that is not the table's last. The user moves the label themselves.
//   2. Relocate the label out of the table: cut the label line from where
//      it sits and put it below the table, then give it the blank line.
//   3. Fix it, then let move-to-bottom carry the label away as it already
//      does, and drop the blank line it leaves behind so the rows close
//      back up.
// Remedy 3 is the smallest change but only helps when move-to-bottom is
// on; remedies 1 and 2 hold with every rule combination.
//
// Hunt: 2026-09-13
// Lens: the fix-lazy-definitions rule (its interaction with tables and with
// move-to-bottom).
//
// Source of truth: the GFM spec, "Tables (extension)", for the break on a
// blank line; manual sheet 14, whose only table fixture puts the label
// under the LAST row of the table, where the inserted blank line falls
// after the table and costs nothing. Nothing in the sheets covers a label
// above a row.
//
// Worth one confirmation in Obsidian's Reading view: GFM's break-on-blank
// rule is quoted from the spec, and Obsidian's renderer has not been
// checked on this exact shape. If Obsidian keeps the rows below the blank
// line as a table, the whole question goes away.
//
// The assertions below are written for reading two, so they are red today.

const MIDDLE_ROW = ["| a | b |", "| - | - |", "| c | d |", "[^1]: x", "| e | f |", "", "ref[^1]"].join("\n");
const DELIMITER_ROW = ["| a | b |", "| - | - |", "[^1]: x", "| c | d |", "", "ref[^1]"].join("\n");

// RULED 2026-09-15 (Jason, ruling A2, verified in Reading view): a label
// directly under a table row is a DEFINITION, because a definition ends
// the table the way any block does. So no label under a row is lazy, the
// fix-lazy rule inserts nothing under a table, and a label INSIDE a table
// (rows continuing after it) is the user's mistake: the plugin leaves it
// alone and a lint alert names it (Obsidian folds the rows after the
// label into the footnote's text as a lazy continuation).

describe("a label under a table row that is not the last", () => {
    it("is a definition, and the fix rule inserts nothing (label under a middle body row)", () => {
        expect(fixLazyDefinitions(MIDDLE_ROW)).toBe(MIDDLE_ROW);
    });

    it("nor when the label sits directly under the delimiter row", () => {
        expect(fixLazyDefinitions(DELIMITER_ROW)).toBe(DELIMITER_ROW);
    });

    it("the default lint leaves the label and the row Obsidian folds into the footnote where they are, for the alert to name", () => {
        // Reading view ends the table at the label and reads "| e | f |"
        // as the footnote's lazy text (the A2 alert says so, and a lone
        // piped line under a label was probed as body text 2026-09-16).
        // GLM hunt cycle 10 let the move carry the label and that row to
        // the bottom, which renders the same, but then the in-table alert
        // found nothing to name, and a row the user typed into the table
        // ended up at the bottom of the note. Under ruling A2 the plugin
        // leaves such a label where it is and the alert tells the user, so
        // the lint moves nothing here (hunt 2026-10-02, round 4, cluster
        // A1, pin bug-lint-move-silences-in-table-alert).
        expect(lintFootnotes(MIDDLE_ROW)).toBe(MIDDLE_ROW);
    });

    it("the lint is stable: a second lint changes nothing", () => {
        const once = lintFootnotes(MIDDLE_ROW);
        expect(lintFootnotes(once)).toBe(once);
    });
});

describe("the boundary: sheet 14's fixture, the label under the LAST row", () => {
    const LAST_ROW = ["| a | b |", "| - | - |", "| c | d |", "[^1]: x", "", "ref[^1]"].join("\n");

    it("the label is a definition, so the fix rule leaves the note alone", () => {
        expect(fixLazyDefinitions(LAST_ROW)).toBe(LAST_ROW);
    });

    it("and the default lint keeps every row together", () => {
        expect(lintFootnotes(LAST_ROW)).toBe(
            "| a | b |\n| - | - |\n| c | d |\n\nref[^1]\n\n[^1]: x",
        );
    });
});
