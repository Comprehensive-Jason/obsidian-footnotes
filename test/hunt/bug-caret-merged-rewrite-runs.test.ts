import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";

// BUG (annoyance): a caret after the changed characters of a line the lint
// rewrote jumps to the start of the change when the line next to it
// changed too.
//
// What the user would see: two neighbouring list items, "- apple[^2] is
// red" and "- pear[^1] is green", with the caret in "red". The lint
// renumbers both references, and the caret jumps back into the first
// reference, between "[^" and "1", instead of staying in "red". The same
// happens on the line
// being typed when the lint also inserts or deletes a line next to it
// (a definition moved below it, a section heading inserted above a
// renamed definition).
//
// Hunt 2026-10-06, cycle 3, lens diff. Cluster D3.
//
// Origin: pre-existing (cec4352 gives the same).
//
// Source of truth: lineDiffChanges's own comment in
// src/editor/document-diff.ts ("a caret sitting after the changed
// characters on a changed line then keeps its column, since only the
// differing characters are rewritten (Jason's report: the caret went to
// the line's start)"). CodeMirror maps the caret with assoc -1 (it stays
// before text inserted at its position) when Editor.transaction
// dispatches without a selection.
//
// Cause: withRewrittenLines in src/editor/document-diff.ts merges a line
// rewritten in place with a neighbouring rewritten, deleted, or inserted
// line into one edit, which then spans from the first changed character
// of the first line to the last of the second, and a caret inside that
// span goes to the edit's start.

/** A line with its footnotes taken out and its runs of spaces counted as one: how a line is recognised after the lint. */
const stripped = (line: string) => line.replace(/\[\^[^\]]*\]/g, "").replace(/\^\[[^\]]*\]/g, "").replace(/\s+/g, " ").trimEnd();

/** For each line, whether it is prose: text that is no part of a footnote definition. */
function proseFlags(lines: string[]): boolean[] {
    const prose = lines.map((l) => l.trim() !== "");
    for (const d of readNote(lines).definitions) for (let i = d.start; i <= d.end; i++) prose[i] = false;
    return prose;
}

/** The index of the one line whose stripped text is `key`, or -1 when none or several are. */
function uniqueBy(lines: string[], key: string): number {
    const keys = lines.map(stripped);
    const first = keys.indexOf(key);
    return first !== -1 && keys.indexOf(key, first + 1) === -1 ? first : -1;
}

/**
 * The first prose line the lint rewrote where a caret placed inside the
 * line's unchanged end does not keep its place, or null when every such
 * caret does.
 */
function caretAfterRewriteMiss(before: string, after: string) {
    const a = before.split("\n");
    const b = after.split("\n");
    const proseA = proseFlags(a);
    const proseB = proseFlags(b);
    const changes = lineDiffChanges(before, after);
    const set = ChangeSet.of(changes.map((c) => ({ from: c.from, to: c.to, insert: c.text })), before.length);
    const starts = [0];
    for (const l of a) starts.push(starts[starts.length - 1] + l.length + 1);
    const bStarts = [0];
    for (const l of b) bStarts.push(bStarts[bStarts.length - 1] + l.length + 1);
    for (let i = 0; i < a.length; i++) {
        if (!proseA[i]) continue;
        const key = stripped(a[i]);
        if (key === "" || uniqueBy(a, key) !== i) continue;
        const j = uniqueBy(b, key);
        if (j === -1 || !proseB[j] || a[i] === b[j]) continue;
        // the common end of the old and new line
        let k = 0;
        while (k < a[i].length && k < b[j].length && a[i][a[i].length - 1 - k] === b[j][b[j].length - 1 - k]) k++;
        if (k < 2) continue;
        const back = Math.floor(k / 2);
        const mapped = set.mapPos(starts[i] + a[i].length - back, -1);
        let line = 0;
        while (line < b.length - 1 && mapped >= bStarts[line + 1]) line++;
        const got = { line, ch: mapped - bStarts[line] };
        const expected = { line: j, ch: b[j].length - back };
        if (got.line !== expected.line || got.ch !== expected.ch) return { line: i, text: a[i], newText: b[j], expected, got, changes };
    }
    return null;
}

describe("a caret after the changed characters on a rewritten line keeps its place", () => {
    it("two neighbouring list items renumbered: a caret after the reference on the first keeps its column", () => {
        const before = "- apple[^2] is red\n- pear[^1] is green\n\n[^1]: p\n[^2]: a";
        const after = lintFootnotes(before, {});
        expect(after).toBe("- apple[^1] is red\n- pear[^2] is green\n\n[^1]: a\n[^2]: p");
        const changes = lineDiffChanges(before, after);
        const set = ChangeSet.of(changes.map((c) => ({ from: c.from, to: c.to, insert: c.text })), before.length);
        // the caret at "- apple[^2] is r|ed"
        const mapped = set.mapPos("- apple[^2] is r".length, -1);
        expect(after.slice(0, mapped) + "|" + after.slice(mapped, mapped + 3)).toBe("- apple[^1] is r|ed\n");
    });

    it("the note being typed in, with the typing line renumbered: the caret stays after the changed characters", () => {
        const typing = "More text[^3][^2] and I am typing here";
        const note = ["# Part one", "Text.[^1]", "", "[^1]: one", "[^2]: two", "[^3]: three", "", typing].join("\n");
        const after = lintFootnotes(note, {});
        expect(after.split("\n")).toEqual(["# Part one", "Text.[^1]", "", "More text[^2][^3] and I am typing here", "", "[^1]: one", "[^2]: three", "[^3]: two"]);
        expect(caretAfterRewriteMiss(note, after)).toBeNull();
    });

    it("a definition moved below the renumbered last prose line", () => {
        const before = "[^2]: two\n\ntext[^2] more words";
        const after = lintFootnotes(before, {});
        expect(after).toBe("text[^1] more words\n\n[^1]: two");
        expect(caretAfterRewriteMiss(before, after)).toBeNull();
    });

    // Before the fix: the caret goes to the start of "# Footnotes", as in
    // pin bug-caret-jumps-to-inserted-line before its fix.
    it("a section heading inserted above a renamed definition: a caret at the start of the definition stays on it", () => {
        const before = "text[^2] here\n\n[^2]: alpha";
        const after = lintFootnotes(before, { sectionHeading: "# Footnotes" });
        expect(after.split("\n")).toEqual(["text[^1] here", "", "# Footnotes", "", "[^1]: alpha"]);
        const changes = lineDiffChanges(before, after);
        const set = ChangeSet.of(changes.map((c) => ({ from: c.from, to: c.to, insert: c.text })), before.length);
        const mapped = set.mapPos("text[^2] here\n\n".length, -1);
        expect(mapped).toBe("text[^1] here\n\n# Footnotes\n\n".length);
    });
});
