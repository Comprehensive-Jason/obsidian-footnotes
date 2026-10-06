import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): the caret on the line being typed jumps to the last
// definition when the lint moves a block of definitions from above that
// line to the bottom of the note.
//
// What the user would see: three definitions sit in the middle of the
// note, and the user is typing on a line of prose under them. They save,
// and the default lint gathers the definitions at the bottom. The line
// they were typing on is unchanged and now sits above the definitions, but
// the caret is at the end of "[^3]: three", the last definition, so the
// next keystroke lands in a footnote. A second pane showing the same note
// loses its place the same way.
//
// Hunt 2026-10-05, round 2, lens diff. Cluster D1.
//
// Source of truth: manual sheet 12 ("put the caret on an unchanged line,
// and Ctrl+S: the note is linted ... the caret is still where it was");
// the write-back's own comment in write-back.ts ("a caret in [untouched
// lines] stays put"); lineMapper's contract in document-diff.ts (a line
// below an insertion or deletion shifts with it).
//
// Cause: lineDiffChanges lines up the old and new note with a longest
// common subsequence (the largest set of lines both versions share, in
// order). The three definitions are a longer run than the prose line and
// the blank line, so the diff keeps the definitions where they are and
// treats the prose line as deleted below them and written again above
// them. The caret goes with the deleted line. Note: a Myers diff (an
// approved later subtask) also finds a longest common subsequence, so it
// will not fix this on its own; the diff has to prefer keeping the line
// the caret is on.

/** Where a caret at (line, ch) of `before` ends up in a real CodeMirror state after the write-back edits that turn it into `after`. */
function caretAfter(before: string, after: string, line: number, ch: number) {
    let state = EditorState.create({ doc: before });
    state = state.update({ selection: EditorSelection.cursor(state.doc.line(line + 1).from + ch) }).state;
    const changes = lineDiffChanges(before, after);
    const next = state.update({ changes: changes.map((c) => ({ from: c.from, to: c.to, insert: c.text })) }).state;
    expect(next.doc.toString()).toBe(after);
    const head = next.selection.main.head;
    const at = next.doc.lineAt(head);
    return { line: at.number - 1, ch: head - at.from, text: at.text };
}

const TYPING = "More text[^2][^3] and I am typing here";
const NOTE = ["# Part one", "Text.[^1]", "", "[^1]: one", "[^2]: two", "[^3]: three", "", TYPING].join("\n");

describe("a caret on a prose line below a block of definitions the lint moves to the bottom", () => {
    it("default lint: the caret stays on the line being typed, not on the last definition", () => {
        const after = lintFootnotes(NOTE, {});
        expect(after.split("\n")).toEqual(["# Part one", "Text.[^1]", "", TYPING, "", "[^1]: one", "[^2]: two", "[^3]: three"]);
        // Before the fix: { line: 7, ch: 11, text: "[^3]: three" }.
        expect(caretAfter(NOTE, after, 7, TYPING.length)).toEqual({ line: 3, ch: TYPING.length, text: TYPING });
    });

    it("the same note in a second pane: that pane's caret on the typing line follows it", () => {
        const after = lintFootnotes(NOTE, {});
        // Before the fix: 7, the last definition's line.
        expect(lineMapper(lineDiffChanges(NOTE, after), NOTE)(7)).toBe(3);
    });
});
