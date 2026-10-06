import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): in a note of about 2,000 lines or more, the lint's
// write-back loses the caret and the folds in the middle of the note.
//
// What the user would see: a long draft with a footnote reference near
// the top and the definitions at the bottom. After the lint renumbers the
// top line, a caret 1,000 lines down jumps to the first line of the note.
// A folded list item deep inside a long section comes back folded two
// lines lower, on another item. In a note with more than 2,000 headings,
// the last section's fold lands two lines off its heading.
//
// Hunt 2026-10-05, round 2, lens diff. Cluster D3. This pin is the
// acceptance test for the approved Myers diff subtask (a line diff that
// stays fast on long notes, so it needs no size cap).
//
// Source of truth: manual sheet 12 ("the caret is still where it was",
// "every fold is still folded" after a lint); the header of
// document-diff.ts (the write-back edits only the lines that really
// changed, so folds and the caret in untouched text are left alone).
//
// Cause: the line comparison costs one step per pair of lines, so above
// MaxComparedPairs (4,000,000 pairs, about 2,000 lines on each side) it
// gives up and treats the whole stretch as one change. The cap sits in
// three places: lineDiffChanges (the whole middle of the note becomes one
// edit, so a caret inside it moves to the edit's start), alignRun (the
// lines of a long stretch pair up by position, so a fold below two removed
// lines keeps its old line number instead of moving up with its line),
// and alignLines' heading keys (with thousands of headings on both sides,
// the headings are not lined up at all).

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

describe("a long note: the size cap turns the whole middle into one edit (lineDiffChanges)", () => {
    it.fails("a reindex at the top and the definitions at the bottom of a 2,100-line note leave a caret in the middle alone", () => {
        const body = Array.from({ length: 2100 }, (_, i) => `Paragraph line ${String(i)} of a long draft.`);
        const before = ["Second[^2] then first.[^1]", "", ...body, "", "[^1]: one", "[^2]: two"].join("\n");
        const after = lintFootnotes(before, {});
        expect(after.split("\n")[0]).toBe("Second[^1] then first.[^2]");
        // Today: { line: 0, ch: 8, text: "Second[^1] then first.[^2]" }.
        expect(caretAfter(before, after, 1000, 10)).toEqual({ line: 1000, ch: 10, text: body[998] });
    });
});

describe("a long section: the size cap pairs its lines by position (alignRun)", () => {
    it.fails("a folded list item 1,000 lines into a 2,100-line section keeps its fold after the default lint", () => {
        const body: string[] = [];
        for (let i = 0; i < 1050; i++) body.push(`- item ${String(i)}`, `  - child ${String(i)}`);
        const before = ["# Big", "Text.[^1]", "", "[^1]: one", "", ...body, "", "tail"].join("\n");
        const after = lintFootnotes(before, {});
        const afterLines = after.split("\n");
        expect(afterLines.slice(-3)).toEqual(["tail", "", "[^1]: one"]);
        const item = 5 + 2 * 500; // "- item 500", folded over its child
        expect(before.split("\n")[item]).toBe("- item 500");
        const want = afterLines.indexOf("- item 500");
        // Today: [{ from: 1005, to: 1006 }], two lines below the item.
        expect(mapFoldLines([{ from: item, to: item + 1 }], lineDiffChanges(before, after), before)).toEqual([{ from: want, to: want + 1 }]);
    });
});

describe("a note with very many headings: the heading alignment is skipped (alignLines)", () => {
    it.fails("2,100 sections, a definition moved out of the first one: the last section's fold stays on its heading", () => {
        const lines = ["# S0", "Text.[^1]", "", "[^1]: one", ""];
        for (let k = 1; k <= 2100; k++) lines.push(`# S${String(k)}`, `Body ${String(k)}.`, "");
        const before = lines.join("\n");
        const after = lintFootnotes(before, {});
        const afterLines = after.split("\n");
        const from = lines.indexOf("# S2100");
        const want = afterLines.indexOf("# S2100");
        expect(want).toBe(from - 2);
        // Today: [{ from: 6302, to: 6303 }], two lines below the heading.
        expect(mapFoldLines([{ from, to: from + 1 }], lineDiffChanges(before, after), before)).toEqual([{ from: want, to: want + 1 }]);
    }, 60_000);
});
