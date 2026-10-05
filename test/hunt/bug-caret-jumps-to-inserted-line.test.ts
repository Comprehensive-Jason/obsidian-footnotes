import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges } from "../../src/editor/document-diff";
import { lintFootnotes, LintOptions } from "../../src/linting/linter";

// BUG (annoyance): a caret at the start of a line the lint does not
// change jumps up onto a line the lint inserts right above it.
//
// What the user would see: the note reads "prose[^1]" with "[^1]: def"
// straight under it, and the caret sits at the start of "[^1]: def".
// The lint (with the default settings) adds the blank line above the
// label that makes it a definition. Afterwards the caret is on that new
// blank line, not on "[^1]: def", though that line did not change.
//
// Hunt 2026-10-05, round 1, lens properties. Cluster PR5. Found by the
// property "a caret on an untouched line stays on that line" over random
// notes and options.
//
// Source of truth: manual sheet 12 ("put the caret on an unchanged line,
// and Ctrl+S: the note is linted ... the caret is still where it was");
// the write-back's own comment in write-back.ts ("a caret in [untouched
// lines] stays put").
//
// Cause: lineDiffChanges writes each inserted line as "text\n" at the
// START of the line below it. The write-back hands those edits to the
// editor in one transaction with no selection of its own
// (Editor.transaction), and CodeMirror then carries an empty selection
// that sits exactly where text is inserted to the front of that text
// (assoc -1, the side a position sticks to). So a caret at column 0 of
// the line below ends up on the first inserted line. The test checks
// this against the real @codemirror/state the editor runs on.

/** Where a caret at (line, ch) ends up in a real CodeMirror state after the lint's write-back edits. */
function caretAfterLint(before: string, options: LintOptions, line: number, ch: number) {
    const after = lintFootnotes(before, options);
    let state = EditorState.create({ doc: before });
    state = state.update({ selection: EditorSelection.cursor(state.doc.line(line + 1).from + ch) }).state;
    const changes = lineDiffChanges(before, after);
    const next = state.update({ changes: changes.map((c) => ({ from: c.from, to: c.to, insert: c.text })) }).state;
    expect(next.doc.toString()).toBe(after);
    const head = next.selection.main.head;
    const at = next.doc.lineAt(head);
    return { line: at.number - 1, ch: head - at.from, text: at.text };
}

describe("a caret at column 0 of an untouched line, with lines inserted right above it", () => {
    it.fails("default lint, caret at the start of a lazy label: the caret stays on the label line", () => {
        // Fix lazy definitions inserts the blank line that makes "[^1]: def"
        // a definition; the label line itself is unchanged.
        const before = "prose[^1]\n[^1]: def";
        expect(lintFootnotes(before, {})).toBe("prose[^1]\n\n[^1]: def");
        // Today: { line: 1, ch: 0, text: "" }, the caret is on the new blank line.
        expect(caretAfterLint(before, {}, 1, 0)).toEqual({ line: 2, ch: 0, text: "[^1]: def" });
    });

    it.fails("orphan-reference deletion, caret at the start of a comment line two lines below", () => {
        const before = "[^1]\n\n%% c %%\n[^94]: lazy under a comment line";
        const options: LintOptions = { removeOrphanedReferences: true };
        expect(lintFootnotes(before, options)).toBe("\n\n%% c %%\n\n[^1]: lazy under a comment line");
        // Today: { line: 1, ch: 0, text: "" }.
        expect(caretAfterLint(before, options, 2, 0)).toEqual({ line: 2, ch: 0, text: "%% c %%" });
    });
});
