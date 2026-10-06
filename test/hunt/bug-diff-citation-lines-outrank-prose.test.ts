import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): when every paragraph ends in a line of only footnotes
// (a "citation line" such as "[^4]") and the lint renumbers them, the lint
// rewrites unchanged paragraph lines, so the caret and another pane's view
// jump one paragraph up.
//
// What the user would see: a note with four paragraphs, each followed by
// its own citation line "[^1]", "[^4]", "[^2]", "[^3]" (the footnote added
// last sits in the middle). Ctrl+S renumbers them to "[^1]" ... "[^4]" and
// changes nothing else in the paragraphs. Yet with the caret on "Fourth
// paragraph." the caret ends up on the line reading "Third paragraph.";
// a second pane showing the note, and a folded list item, land one
// paragraph up too. The same with two "Para line" paragraphs around two
// citation lines.
//
// The lint hands the editor a list of small edits (a "diff") rather than
// the whole new note, so the caret, folds, and other panes stay on the
// lines they were on. Here the diff pairs the wrong lines.
//
// Hunt 2026-10-06, cycle 4, lens diff. Cluster D1.
//
// Origin: regression (since ea38e82, from 0ecc8e9).
//
// Source of truth: manual sheet 12, "Lint triggers and settings page"
// ("put the caret on an unchanged line, and Ctrl+S: ... the caret is still
// where it was"); lineDiffChanges's own comment (a caret after the changed
// characters on a changed line keeps its column); the lint's promise that
// it never moves prose.
//
// Cause: lineDiffChanges in src/editor/document-diff.ts lines up the old
// and new note by a key per line. Since 0ecc8e9 a line of only footnotes
// keeps its names in its key, so a renumbered "[^4]" no longer matches its
// own new "[^2]". The line-up then pairs it with another citation line
// that reads the same, and to make the rest fit it rewrites unchanged
// paragraph lines into their neighbours' text.

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

const fourParagraphs = [
    "First paragraph.", "[^1]", "",
    "Second paragraph.", "[^4]", "",
    "Third paragraph.", "[^2]", "",
    "Fourth paragraph.", "[^3]", "",
    "[^1]: one", "[^2]: two", "[^3]: three", "[^4]: four",
].join("\n");

describe("citation lines renumbered by the lint keep the paragraphs around them in place", () => {
    // Now: the caret at the end of "[^4]" on line 4 is the first to miss,
    // and the one on "Fourth paragraph." ends on "Third paragraph.".
    it.fails("a citation line under each paragraph, one added in the middle: every unchanged paragraph line keeps the caret", () => {
        const after = lintFootnotes(fourParagraphs, {});
        expect(after.split("\n").slice(0, 11)).toEqual(["First paragraph.", "[^1]", "", "Second paragraph.", "[^2]", "", "Third paragraph.", "[^3]", "", "Fourth paragraph.", "[^4]"]);
        expect(caretMiss(fourParagraphs, after)).toBeNull();
    });

    // Now: lines 0, 3, 6, 9 map to 0, 3, 3, 6.
    it.fails("a citation line under each paragraph, one added in the middle: another pane's caret on each paragraph stays on it", () => {
        const after = lintFootnotes(fourParagraphs, {});
        const map = lineMapper(lineDiffChanges(fourParagraphs, after), fourParagraphs);
        // The lint moves no prose line, so each paragraph line keeps its line number.
        expect([0, 3, 6, 9].map(map)).toEqual([0, 3, 6, 9]);
    });

    // Now: one edit deletes the stretch from "[^3]" through the second
    // "Para line" and writes it back further down.
    it.fails("two paragraphs ending in renumbered reference-only lines: the unchanged prose line between keeps the caret", () => {
        const before = ["Para line", "[^1]", "", "[^3]", "", "Para line", "[^2]"].join("\n");
        const after = lintFootnotes(before, {});
        expect(after.split("\n")).toEqual(["Para line", "[^1]", "", "[^2]", "", "Para line", "[^3]"]);
        // The second "Para line" is not touched by the lint, so no edit may cover it.
        const changes = lineDiffChanges(before, after);
        const start = before.indexOf("\nPara line") + 1;
        expect(changes.filter((c) => c.from < start + "Para line".length && c.to > start)).toEqual([]);
        expect(caretMiss(before, after)).toBeNull();
    });
});
