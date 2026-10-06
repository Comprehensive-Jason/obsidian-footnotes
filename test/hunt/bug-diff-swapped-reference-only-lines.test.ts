import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): two neighbouring lines of only footnotes whose names the
// lint swaps: the caret at the end of the first jumps to the start of the
// line, and another pane slides up a line.
//
// What the user would see: a note "Text", "[^2]", "[^1]", with the
// definitions below. Ctrl+S renumbers the two lines to "[^1]" and "[^2]".
// With the caret at the end of the first of them, the caret ends at the
// start of that line instead of its end. A second pane showing the note
// with its caret on either of the two lines moves that caret one line up.
//
// The lint hands the editor a list of small edits (a "diff") rather than
// the whole new note, so the caret and other panes stay on the lines they
// were on.
//
// Hunt 2026-10-06, cycle 4, lens diff. Cluster D2.
//
// Origin: pre-existing for the caret in the editor; regression for the
// other pane's line mapping (since ea38e82, from 0ecc8e9: at ea38e82 lines
// 1 and 2 map to 1 and 2, now to 0 and 1).
//
// Source of truth: manual sheet 12, "Lint triggers and settings page"
// ("put the caret on an unchanged line, and Ctrl+S: ... the caret is still
// where it was"); lineDiffChanges's own comment (a caret after the changed
// characters on a changed line keeps its column); lineMapper's contract (a
// line rewritten in place is still the same line).
//
// Cause: lineDiffChanges in src/editor/document-diff.ts lines up the old
// and new note by a key per line. Since 0ecc8e9 a line of only footnotes
// keeps its names in its key, so the old "[^2]" lines up with the new
// "[^2]" one line further down, and the edits delete and re-add whole
// lines instead of changing one character on each.

/** Whether a line is a definition's label line, such as "[^1]: one". */
const isLabel = (l: string) => /^\[\^[^\]]+\]:/.test(l);

/** The prose lines of a note: text that is no definition line and no "    cont" continuation. */
const proseIndexes = (lines: string[]) => lines.flatMap((l, i) => (l.trim() !== "" && !isLabel(l) && l !== "    cont" ? [i] : []));

/**
 * Where the editor puts a caret at (line, ch) of `before` once the edits
 * are applied, as CodeMirror maps it (with assoc -1, as when the lint's
 * transaction carries no selection).
 */
function mapCaret(before: string, after: string, changes: ReturnType<typeof lineDiffChanges>, line: number, ch: number) {
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

/**
 * The first caret on a prose line that does not keep its place, or null.
 * It tries every column before the first changed character and after the
 * last one on each prose line.
 */
function caretMiss(before: string, after: string) {
    const changes = lineDiffChanges(before, after);
    const a = before.split("\n");
    const b = after.split("\n");
    const pa = proseIndexes(a);
    const pb = proseIndexes(b);
    if (pa.length !== pb.length) return null;
    for (let k = 0; k < pa.length; k++) {
        const x = a[pa[k]];
        const y = b[pb[k]];
        let head = 0;
        while (head < x.length && head < y.length && x[head] === y[head]) head++;
        let tail = 0;
        while (tail < Math.min(x.length, y.length) - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
        const cols: [number, number][] = [];
        for (let c = 0; c <= head; c++) cols.push([c, c]);
        for (let t = 0; t <= tail; t++) cols.push([x.length - t, y.length - t]);
        for (const [c, expectCh] of cols) {
            const got = mapCaret(before, after, changes, pa[k], c);
            if (got.line !== pb[k] || got.ch !== expectCh) return { line: pa[k], text: x, newText: y, col: c, expected: { line: pb[k], ch: expectCh }, got };
        }
    }
    return null;
}

const before = ["Text", "[^2]", "[^1]", "", "[^1]: one", "[^2]: two"].join("\n");

describe("two swapped reference-only lines", () => {
    // Now: the caret at the end of "[^2]" on line 1 lands at ch 0.
    it("the caret at the end of the first stays on the first", () => {
        const after = lintFootnotes(before, {});
        expect(after.split("\n").slice(0, 3)).toEqual(["Text", "[^1]", "[^2]"]);
        expect(caretMiss(before, after)).toBeNull();
    });

    // Now: lines 1 and 2 map to 0 and 1.
    it("another pane's caret on each of the two lines stays on its line", () => {
        const after = lintFootnotes(before, {});
        const map = lineMapper(lineDiffChanges(before, after), before);
        expect([1, 2].map(map)).toEqual([1, 2]);
    });
});
