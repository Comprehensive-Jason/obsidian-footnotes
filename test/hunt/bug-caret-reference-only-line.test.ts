import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): a caret on a line that holds only a reference ("[^1]")
// jumps away when the lint empties another such line, though the lint
// leaves the caret's line as it was.
//
// What the user would see: a note has a line "[^9]" (a reference to a
// footnote with no definition) and, further down, a line "[^1]". With
// Delete orphaned references on, the lint takes out "[^9]" and moves
// [^1]'s definition to the bottom. The "[^1]" line is untouched, but the
// caret at its end lands on the next prose line, or on the moved
// definition, instead of staying put. A second pane showing that line
// moves the same way.
//
// Hunt 2026-10-06, cycle 3, lens diff. Cluster D1.
//
// Origin: regression (since cec4352, from 16d1887 / fcd3970, the
// prose-first line-up, and 8272e13, its lineKey; dfcc017 first lined lines
// up by their text without footnotes) for the edited pane's caret. The
// second pane's line mapping was already wrong at cec4352 (pre-existing;
// see that test's comment).
//
// Source of truth: manual sheet 12 ("put the caret on an unchanged line,
// and Ctrl+S: ... the caret is still where it was"); write-back.ts ("a
// caret in [untouched lines] stays put"); lineMapper's contract (a line
// below an insertion or deletion shifts with it). CodeMirror maps the
// caret with assoc -1 when Editor.transaction dispatches without a
// selection, as EditorState.update does here.
//
// Cause: lineKey in src/editor/document-diff.ts takes every footnote out
// of a line, so a line holding only references keys as "", yet still
// counts as prose (proseLines: any line with text that is no part of a
// definition). When the orphan rule empties the "[^9]" line, the prose
// pass pairs the old "[^9]" line with the new "[^1]" line (same key ""),
// and the untouched "[^1]" line is taken as deleted.

/** Where a caret at (line, ch) of `before` lands once the lint's line diff turns it into `after`. */
function caretAfter(before: string, after: string, line: number, ch: number) {
    let state = EditorState.create({ doc: before });
    state = state.update({ selection: EditorSelection.cursor(state.doc.line(line + 1).from + ch) }).state;
    const next = state.update({ changes: lineDiffChanges(before, after).map((c) => ({ from: c.from, to: c.to, insert: c.text })) }).state;
    expect(next.doc.toString()).toBe(after);
    const head = next.selection.main.head;
    const at = next.doc.lineAt(head);
    return { line: at.number - 1, ch: head - at.from, text: at.text };
}

const options = { removeOrphanedReferences: true };

describe("a line holding only a reference keeps the caret when the lint empties another such line", () => {
    // The orphaned reference "[^9]" is taken out, which leaves its line
    // blank; the line "[^1]" two lines below is untouched by the lint, and
    // the definition above it moves to the bottom.
    const before = ["Intro", "", "[^1]: one", "", "[^9]", "", "[^1]", "", "End"].join("\n");

    it("control: the lint takes out the orphan and leaves the [^1] line as it was", () => {
        expect(lintFootnotes(before, options).split("\n")).toEqual(["Intro", "", "", "", "[^1]", "", "End", "", "[^1]: one"]);
    });

    // Before the fix: { line: 6, ch: 0, text: "End" }; the cec4352 diff kept it on "[^1]".
    it.fails("a caret at the end of the unchanged [^1] line stays there", () => {
        const after = lintFootnotes(before, options);
        expect(caretAfter(before, after, 6, 4)).toEqual({ line: 4, ch: 4, text: "[^1]" });
    });

    // Pre-existing: the cec4352 line mapper gave the same wrong line here.
    it.fails("a second pane's caret on the [^1] line stays on it", () => {
        const after = lintFootnotes(before, options);
        expect(lineMapper(lineDiffChanges(before, after), before)(6)).toBe(4);
    });

    // Before the fix: { line: 4, ch: 4, text: "[^1]: one" }; the cec4352 diff kept it on "[^1]".
    it.fails("shorter: the caret on the [^1] line does not land on the moved definition", () => {
        const b = ["[^1]: one", "", "[^9]", "", "[^1]"].join("\n");
        const after = lintFootnotes(b, options);
        expect(after.split("\n")).toEqual(["", "", "[^1]", "", "[^1]: one"]);
        expect(caretAfter(b, after, 4, 4)).toEqual({ line: 2, ch: 4, text: "[^1]" });
    });

    // The random case the hunt's differential run found (the cec4352 diff
    // kept the caret on line 21, column 3; now it goes to line 23, column 0).
    it.fails("random case: the caret on an untouched [^Note] line does not jump to the ## Five heading", () => {
        const b = [
            "## Two", "", "---", "title: t", "---", "```", "fake[^Note]", "```", "", "[^Note]: aside ^[nested inline]", "",
            "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Lorem ipsum dolor sit amet[^1].",
            "", "Ut enim ad minim veniam[^9].", "", "# One", "", "[^ch-2]: alpha", "",
            "\\[^81]. ^[an inline note] charlie[^1], [^a$1] alpha[^2].", "", "Duis aute irure.[^1]", "", "[^42]", "", "[^Note]", "", "## Five",
        ].join("\n");
        const after = lintFootnotes(b, {
            fixPunctuation: true,
            placement: "after",
            fixLazyDefinitions: true,
            moveDefinitionsToBottom: true,
            reindex: false,
            removeOrphanedReferences: true,
            applyNotePrefix: true,
            orphanSafePrefix: "ch2*",
            sectionHeading: "# Footnotes",
        });
        const lines = after.split("\n");
        const j = lines.indexOf("[^Note]");
        expect(j).not.toBe(-1);
        expect(caretAfter(b, after, 25, 3)).toEqual({ line: j, ch: 3, text: "[^Note]" });
    });
});
