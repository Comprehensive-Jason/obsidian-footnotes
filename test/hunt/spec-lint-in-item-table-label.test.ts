import { describe, expect, it } from "vitest";

import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";

// spec question: a definition label typed between the rows of a table
// inside a list item: should the lint leave the table alone, as it does
// for the same table at the left margin or in a blockquote?
//
// What it does now: a list item holds a table, and "[^1]: x" is typed under
// its delimiter row, with one more row below. With Move definitions to
// bottom off, the fix-lazy rule inserts a blank line between the delimiter
// row and the label, splitting the item's table. The in-table alert stays
// silent. The same table inside a blockquote is left alone and named by
// the alert.
// What a user might expect: ruling A2 (2026-09-15): a label inside a table
// is never edited, and the in-table alert names it.
// Why it is a question and not a bug: the in-item reader wants a blank line
// above a label to call it a definition, which is what fix-lazy is
// supplying, and nobody has checked how Obsidian reads "  [^1]: x" under a
// table row inside a list item.
//
// Needs a Reading-view check: "use[^1]", a blank line, "- | a | b |",
// "  | - | - |", "  [^1]: x", "  | e | f |". Is [^1] a footnote, a table
// row's text, or plain text?
//
// Hunt 2026-10-02, round 4, lens alerts. Cluster A11.
//
// Source of truth: ruling A2 (the fix-lazy rule inserts nothing under a
// table row) and the quoted twin's behaviour; Obsidian's Reading view,
// which has not been probed for this shape.

describe("spec question: a definition inside a table inside a list item", () => {
    it("the lint inserts nothing into the item's table", () => {
        const doc = "use[^1]\n\n- | a | b |\n  | - | - |\n  [^1]: x\n  | e | f |\n";
        const plugin = fakePlugin({ ...DEFAULT_SETTINGS, lintMoveToBottom: false });
        // Today: a blank line lands between "  | - | - |" and "  [^1]: x".
        expect(lintFootnotes(doc, lintOptionsFromSettings(plugin, "", doc))).toBe(doc);
    });
});
