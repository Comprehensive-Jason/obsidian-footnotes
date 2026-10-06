import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): with Delete orphaned references on, taking out an
// orphaned reference at the start of the line being typed sends the caret
// to a definition the lint moved past that line.
//
// An "orphaned" reference is one whose footnote has no definition; Delete
// orphaned references takes it out of the text.
//
// What the user would see: "[^1]: one" above the paragraph "[^2] alpha[^1]
// bravo.", where [^2] has no definition. The caret sits at the end of the
// paragraph. Ctrl+S takes out "[^2] " and moves [^1]'s definition below
// the paragraph; the caret lands at the end of "[^1]: one" instead of
// staying at the end of the line being typed. A second pane showing the
// paragraph lands on the definition too.
//
// Hunt 2026-10-06, cycle 5, lens diff. Cluster X21.
//
// Origin: pre-existing.
//
// Source of truth: manual sheet 12, "Lint triggers and settings page"
// ("the caret is still where it was"); write-back.ts ("a caret in
// [untouched lines] stays put"), and the line-up's own rule that a line
// the lint only changed footnotes on is the same line, rewritten in place;
// lineMapper's contract (a line rewritten in place is still the same
// line). Pin bug-caret-below-moved-definitions holds the same promise for
// an unchanged line the lint moves definitions past.
//
// Cause: lineKey in src/editor/document-diff.ts lines lines up by their
// text with the footnotes taken out, and trims spaces only at the end
// (trimEnd). "[^2] alpha[^1] bravo." keys as " alpha bravo.", with the
// space that followed "[^2]" left at the front, while the lint's "alpha[^1]
// bravo." keys as "alpha bravo.". The two do not match, so the paragraph
// is taken as deleted and written again, and the caret at its end is
// carried to the moved definition. Trimming the key at both ends would
// pair them.

/**
 * Where the editor puts a caret at (line, ch) of `before` once the lint's
 * edits are applied. CodeMirror carries the caret through the edits with
 * "assoc -1" (a caret where text is replaced goes to the start of the new
 * text), as it does when the plugin's Editor.transaction carries no
 * selection.
 */
function mapCaret(before: string, after: string, line: number, ch: number) {
    const changes = lineDiffChanges(before, after);
    const a = before.split("\n");
    let off = ch;
    for (let i = 0; i < line; i++) off += a[i].length + 1;
    const set = ChangeSet.of(changes.map((c) => ({ from: c.from, to: c.to, insert: c.text })), before.length);
    const mapped = set.mapPos(off, -1);
    const b = after.split("\n");
    let l = 0;
    let rest = mapped;
    while (l < b.length - 1 && rest > b[l].length) {
        rest -= b[l].length + 1;
        l++;
    }
    return { line: l, ch: rest };
}

/** The lines joined into one note. */
const L = (...lines: string[]) => lines.join("\n");

describe("an orphaned reference at a line's start, taken out while a definition moves past the line", () => {
    const options = { removeOrphanedReferences: true };
    const before = L("[^1]: one", "", "[^2] alpha[^1] bravo.");

    it("control: the lint takes out [^2] and moves the definition below the line", () => {
        expect(lintFootnotes(before, options)).toBe(L("alpha[^1] bravo.", "", "[^1]: one"));
    });

    // Now: the caret at the end of the line being typed lands at the end of
    // "[^1]: one" (line 2).
    it.fails("the caret at the end of the line being typed stays on it", () => {
        const after = lintFootnotes(before, options);
        expect(mapCaret(before, after, 2, before.split("\n")[2].length)).toEqual({ line: 0, ch: "alpha[^1] bravo.".length });
    });

    // Now: line 2 maps to line 2 (the moved definition).
    it.fails("a second pane's caret on the line stays on it", () => {
        const after = lintFootnotes(before, options);
        expect(lineMapper(lineDiffChanges(before, after), before)(2)).toBe(0);
    });
});
