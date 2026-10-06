import { EditorSelection, EditorState } from "@codemirror/state";
import type { Editor, EditorChange, EditorPosition } from "obsidian";
import { describe, expect, it } from "vitest";

import { lineDiffChanges } from "../../src/editor/document-diff";
import { replaceMinimal } from "../../src/editor/write-back";
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
    it("default lint, caret at the start of a lazy label: the caret stays on the label line", () => {
        // Fix lazy definitions inserts the blank line that makes "[^1]: def"
        // a definition; the label line itself is unchanged.
        const before = "prose[^1]\n[^1]: def";
        expect(lintFootnotes(before, {})).toBe("prose[^1]\n\n[^1]: def");
        // Today: { line: 1, ch: 0, text: "" }, the caret is on the new blank line.
        expect(caretAfterLint(before, {}, 1, 0)).toEqual({ line: 2, ch: 0, text: "[^1]: def" });
    });

    it("orphan-reference deletion, caret at the start of a comment line two lines below", () => {
        const before = "[^1]\n\n%% c %%\n[^94]: lazy under a comment line";
        const options: LintOptions = { removeOrphanedReferences: true };
        expect(lintFootnotes(before, options)).toBe("\n\n%% c %%\n\n[^1]: lazy under a comment line");
        // Today: { line: 1, ch: 0, text: "" }.
        expect(caretAfterLint(before, options, 2, 0)).toEqual({ line: 2, ch: 0, text: "%% c %%" });
    });
});

// BUG (annoyance): the same jump at column 0 of the note's FIRST line,
// when the lint inserts lines above it.
//
// What the user would see: the note starts with "[^1]: alpha" and the
// caret sits at its start. The lint (with a section heading set) adds
// "# Footnotes" and a blank line above it. Afterwards the caret is on
// "# Footnotes", not on "[^1]: alpha", though that line did not change.
//
// Hunt 2026-10-05, round 2, lens diff. Cluster D2.
//
// Cause: the fix above writes inserted lines at the END of the line
// above them, but the first line has no line above it. That case (the
// s === 0 branch of lineDiffChanges) still writes the inserted lines at
// offset 0, the very start of the note, where the caret sits, and the
// editor carries the caret to the front of the inserted text. No
// placement of the edit can avoid that, since any text inserted at
// offset 0 is inserted where the caret is.
//
// Fix: after the edits, the write-back (replaceMinimal in write-back.ts)
// puts a caret that sat at the start of the note at the start of its own
// line, below the new lines; every other caret and selection stays where
// the editor carried it. So these tests drive replaceMinimal, not
// lineDiffChanges alone, through a stand-in for Obsidian's editor over a
// real CodeMirror state: a transaction's edits are positions in the text
// before them and go to CodeMirror in one dispatch, as Obsidian 1.x does
// it (read from its app.js, 2026-10-06), and setSelections sets the
// selection in the text as it is.

/** A stand-in for Obsidian's Editor over a real CodeMirror state, with the selection `ranges` (offsets). */
function codeMirrorEditor(text: string, ranges: { anchor: number; head: number }[]) {
    let state = EditorState.create({ doc: text, extensions: EditorState.allowMultipleSelections.of(true) });
    state = state.update({ selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(r.anchor, r.head))) }).state;
    const toPos = (offset: number) => {
        const line = state.doc.lineAt(offset);
        return { line: line.number - 1, ch: offset - line.from };
    };
    const toOffset = (pos: { line: number; ch: number }) => state.doc.line(pos.line + 1).from + pos.ch;
    let selectionsSet = 0;
    const editor = {
        offsetToPos: toPos,
        listSelections: () => state.selection.ranges.map((r) => ({ anchor: toPos(r.anchor), head: toPos(r.head) })),
        transaction(spec: { changes?: EditorChange[] }) {
            const changes = (spec.changes ?? []).map((c) => ({ from: toOffset(c.from), to: toOffset(c.to ?? c.from), insert: c.text }));
            state = state.update({ changes }).state;
        },
        setSelections(selections: { anchor: EditorPosition; head?: EditorPosition }[]) {
            selectionsSet++;
            state = state.update({
                selection: EditorSelection.create(selections.map((r) => EditorSelection.range(toOffset(r.anchor), toOffset(r.head ?? r.anchor)))),
            }).state;
        },
    };
    return {
        editor: editor as unknown as Editor,
        text: () => state.doc.toString(),
        selections: () => state.selection.ranges.map((r) => ({ anchor: toPos(r.anchor), head: toPos(r.head) })),
        selectionsSet: () => selectionsSet,
    };
}

describe("a caret at column 0 of the note's first line, with lines inserted above it", () => {
    it("a note that starts with its definition: the caret stays on the definition line", () => {
        const before = "[^1]: alpha";
        const options: LintOptions = { sectionHeading: "# Footnotes" };
        const after = lintFootnotes(before, options);
        expect(after).toBe("# Footnotes\n\n[^1]: alpha");
        const pane = codeMirrorEditor(before, [{ anchor: 0, head: 0 }]);
        replaceMinimal(pane.editor, before, after);
        expect(pane.text()).toBe(after);
        // Before the fix: { line: 0, ch: 0 }, on "# Footnotes".
        expect(pane.selections()).toEqual([{ anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 0 } }]);
    });

    it("a second caret further down, and a selection, go where the editor carries them", () => {
        const before = "[^1]: alpha\n[^2]: beta gamma";
        const options: LintOptions = { sectionHeading: "# Footnotes" };
        const after = lintFootnotes(before, options);
        expect(after).toBe("# Footnotes\n\n[^1]: alpha\n[^2]: beta gamma");
        // carets at the note's start and inside "beta", and "gamma" selected
        const pane = codeMirrorEditor(before, [
            { anchor: 0, head: 0 },
            { anchor: 18, head: 18 },
            { anchor: 23, head: 28 },
        ]);
        replaceMinimal(pane.editor, before, after);
        expect(pane.text()).toBe(after);
        expect(pane.selections()).toEqual([
            { anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 0 } },
            { anchor: { line: 3, ch: 6 }, head: { line: 3, ch: 6 } },
            { anchor: { line: 3, ch: 11 }, head: { line: 3, ch: 16 } },
        ]);
    });

    it("a selection from the note's start (Select all) is left to the editor, which keeps the new lines out of it", () => {
        const before = "[^1]: alpha";
        const after = lintFootnotes(before, { sectionHeading: "# Footnotes" });
        const pane = codeMirrorEditor(before, [{ anchor: 0, head: before.length }]);
        replaceMinimal(pane.editor, before, after);
        expect(pane.selectionsSet()).toBe(0);
        expect(pane.selections()).toEqual([{ anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 11 } }]);
    });

    it("a caret anywhere else is left to the editor: the selection is not set again", () => {
        const before = "[^1]: alpha";
        const after = lintFootnotes(before, { sectionHeading: "# Footnotes" });
        const pane = codeMirrorEditor(before, [{ anchor: 3, head: 3 }]);
        replaceMinimal(pane.editor, before, after);
        expect(pane.selectionsSet()).toBe(0);
        expect(pane.selections()).toEqual([{ anchor: { line: 2, ch: 3 }, head: { line: 2, ch: 3 } }]);
    });
});
