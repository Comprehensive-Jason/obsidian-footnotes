import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): with Delete orphaned references on, a lint that empties
// one citation line and renumbers another in the same stretch puts the
// caret, and another pane's caret, on the wrong line.
//
// A "citation line" is a line that holds nothing but references, such as
// "[^2]" on a line of its own. An "orphaned" reference is one whose
// footnote has no definition.
//
// What the user would see: "Para.", then a line "[^9]" and a line "[^2]",
// each a paragraph of its own, then "End", with [^2] defined and [^9] not.
// The caret sits at the end of "[^2]". Ctrl+S empties the "[^9]" line and
// renumbers "[^2]" to "[^1]" where it stands, yet the caret lands at the
// start of "End". A second pane showing the emptied line jumps to the
// renumbered one. With three citation lines, the caret at the end of a
// renumbered one jumps to the next citation line or into the definitions.
//
// Hunt 2026-10-06, cycle 5, lens diff. Cluster X16.
//
// Origin: pre-existing (de2d023 gave it this shape, with citationPairs).
//
// Source of truth: manual sheet 12, "Lint triggers and settings page"
// ("put the caret on an unchanged line, and Ctrl+S: ... the caret is still
// where it was"); citationPairs's own contract (the lint never moves a
// citation line and never adds one; it rewrites the names on it, or
// empties it), so a citation line the lint only renumbered is rewritten
// where it stands and the caret at its end stays at its end; lineMapper's
// contract (a line rewritten in place is still the same line).
//
// Cause: citationPairs in src/editor/document-diff.ts pairs as many
// citation lines as the counts before and after allow. Among the pairings
// with that count, it takes the one that pairs the most lines with the
// same text. When the lint changed the text of every citation line, the
// text says nothing, and the walk through its table takes the first pair
// it can: the emptied "[^9]" line is paired with the renumbered line, and
// the real one is taken as deleted and written again. Breaking the tie by
// position (each line paired with the one in its own place) would keep
// it.

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

describe("an emptied orphan citation line next to a renumbered one", () => {
    const options = { removeOrphanedReferences: true };
    const before = L("Para.", "", "[^9]", "", "[^2]", "", "End", "", "[^2]: two");

    it("control: the lint empties the orphan line and renumbers the other in place", () => {
        expect(lintFootnotes(before, options).split("\n")).toEqual(["Para.", "", "", "", "[^1]", "", "End", "", "[^1]: two"]);
    });

    // Now: the caret at the end of "[^2]" (line 4) lands at the start of
    // "End" (line 6, column 0).
    it.fails("the caret at the end of the renumbered citation line stays at its end", () => {
        const after = lintFootnotes(before, options);
        expect(mapCaret(before, after, 4, 4)).toEqual({ line: 4, ch: 4 });
    });

    // Now: lines 2 and 4 both map to line 4.
    it.fails("a second pane's caret on the emptied line stays on its line", () => {
        const after = lintFootnotes(before, options);
        const map = lineMapper(lineDiffChanges(before, after), before);
        expect([2, 4].map(map)).toEqual([2, 4]);
    });
});

// The same root with three citation lines. Each sits in a paragraph of its
// own (a blank line between each), because Delete orphaned references
// refuses to empty a reference line that would split a paragraph; so all
// of them are in one stretch between the paired "Text" line and the end of
// the note.
describe("an emptied citation line among renumbered ones (every text changes, so the text says nothing about which was emptied)", () => {
    // Now: the diff rewrites "[^9]" into "[^1]" and "[^5]" into "[^2]", and
    // deletes the "[^7]" line, so the caret at the end of "[^5]" goes to
    // line 6.
    it.fails("orphan at the top, two renumbered below: the caret at the end of each renumbered line stays there", () => {
        const before = ["Text", "", "[^9]", "", "[^5]", "", "[^7]", "", "[^5]: five", "[^7]: seven"].join("\n");
        const after = lintFootnotes(before, { removeOrphanedReferences: true });
        expect(after.split("\n").slice(0, 7)).toEqual(["Text", "", "", "", "[^1]", "", "[^2]"]);
        // the caret at the end of "[^5]" (line 4) stays at the end of the line now reading "[^1]"
        expect(mapCaret(before, after, 4, 4)).toEqual({ line: 4, ch: 4 });
        // the caret at the end of "[^7]" (line 6) stays at the end of the line now reading "[^2]"
        expect(mapCaret(before, after, 6, 4)).toEqual({ line: 6, ch: 4 });
    });

    // Now: lines 4 and 6 both map to line 6.
    it.fails("orphan at the top, two renumbered below: another pane's caret on each renumbered line stays on it", () => {
        const before = ["Text", "", "[^9]", "", "[^5]", "", "[^7]", "", "[^5]: five", "[^7]: seven"].join("\n");
        const after = lintFootnotes(before, { removeOrphanedReferences: true });
        const map = lineMapper(lineDiffChanges(before, after), before);
        expect([4, 6].map(map)).toEqual([4, 6]);
    });

    // Now: the caret at the end of "[^7]" (line 6) lands at the start of the
    // first definition (line 8).
    it.fails("orphan in the middle of two renumbered lines: the caret at the end of the last stays there", () => {
        const before = ["Text", "", "[^5]", "", "[^9]", "", "[^7]", "", "[^5]: five", "[^7]: seven"].join("\n");
        const after = lintFootnotes(before, { removeOrphanedReferences: true });
        expect(after.split("\n").slice(0, 7)).toEqual(["Text", "", "[^1]", "", "", "", "[^2]"]);
        expect(mapCaret(before, after, 6, 4)).toEqual({ line: 6, ch: 4 });
        const map = lineMapper(lineDiffChanges(before, after), before);
        expect([2, 6].map(map)).toEqual([2, 6]);
    });

    // Now: the caret at the end of "[^2]" (line 4) goes to line 6.
    it.fails("orphan at the top, two swapped below: the caret at the end of each stays there", () => {
        const before = ["Text", "", "[^9]", "", "[^2]", "", "[^1]", "", "[^1]: one", "[^2]: two"].join("\n");
        const after = lintFootnotes(before, { removeOrphanedReferences: true });
        expect(after.split("\n").slice(0, 7)).toEqual(["Text", "", "", "", "[^1]", "", "[^2]"]);
        expect(mapCaret(before, after, 4, 4)).toEqual({ line: 4, ch: 4 });
        expect(mapCaret(before, after, 6, 4)).toEqual({ line: 6, ch: 4 });
        const map = lineMapper(lineDiffChanges(before, after), before);
        expect([4, 6].map(map)).toEqual([4, 6]);
    });
});
