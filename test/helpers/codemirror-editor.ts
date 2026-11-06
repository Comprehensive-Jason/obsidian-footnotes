import { ChangeSet, EditorSelection, EditorState } from "@codemirror/state";
import type { Editor, EditorChange, EditorPosition } from "obsidian";

// A stand-in for Obsidian's Editor over a real CodeMirror state, for tests
// about where a caret lands after an edit. CodeMirror is the editor inside
// Obsidian, and it is what carries the caret through an edit. The shared fake
// editor (fake-editor.ts) applies edits but leaves the caret alone, so it
// cannot show where the caret really goes.
//
// It holds only what the shared write-back (src/editor/write-back.ts) calls.
// A transaction's edits are positions in the text before them and go to
// CodeMirror in one dispatch, as Obsidian 1.x does it (read from its app.js,
// 2026-10-06), and setSelections sets the selection in the text as it is.
// With no selection in a transaction, CodeMirror carries each caret through
// the edits (assoc -1: a caret where text is replaced goes to the start of
// the new text).
//
// It also holds what a command reads, so a whole command can run on it, and it
// counts the transactions. CodeMirror's history makes one undo step at most of
// one transaction, and it can join two that touch (the live answer H31a saw
// that happen). So one transaction is one undo step whatever the timing, and
// `undo` takes back the last transaction, the note and the selection, as the
// history does. The history package itself is not installed here, so a smoke
// scenario checks the real undo.

/** A stand-in for Obsidian's Editor over a real CodeMirror state, with the selection `ranges` (offsets). */
export function codeMirrorEditor(text: string, ranges: { anchor: number; head: number }[]) {
    let state = EditorState.create({ doc: text, extensions: EditorState.allowMultipleSelections.of(true) });
    state = state.update({ selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(r.anchor, r.head))) }).state;
    const toPos = (offset: number) => {
        const line = state.doc.lineAt(offset);
        return { line: line.number - 1, ch: offset - line.from };
    };
    const toOffset = (pos: { line: number; ch: number }) => state.doc.line(pos.line + 1).from + pos.ch;
    let selectionsSet = 0;
    const undoSteps: { changes: ChangeSet; selection: EditorSelection }[] = [];
    const editor = {
        offsetToPos: toPos,
        posToOffset: toOffset,
        getValue: () => state.doc.toString(),
        getLine: (line: number) => state.doc.line(line + 1).text,
        lineCount: () => state.doc.lines,
        lastLine: () => state.doc.lines - 1,
        getCursor: () => toPos(state.selection.main.head),
        listSelections: () => state.selection.ranges.map((r) => ({ anchor: toPos(r.anchor), head: toPos(r.head) })),
        transaction(spec: { changes?: EditorChange[] }) {
            const changes = (spec.changes ?? []).map((c) => ({ from: toOffset(c.from), to: toOffset(c.to ?? c.from), insert: c.text }));
            const step = state.update({ changes });
            undoSteps.push({ changes: step.changes.invert(state.doc), selection: state.selection });
            state = step.state;
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
        /** How many transactions wrote to the note, which is at most how many undo steps they make. */
        transactions: () => undoSteps.length,
        /** Takes back the last transaction, the note and the selection, as CodeMirror's history does. */
        undo() {
            const step = undoSteps.pop();
            if (step) state = state.update({ changes: step.changes, selection: step.selection }).state;
        },
    };
}
