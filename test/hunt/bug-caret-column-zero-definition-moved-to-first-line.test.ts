import { describe, expect, it } from "vitest";

import { replaceMinimal } from "../../src/editor/write-back";
import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { codeMirrorEditor } from "../helpers/codemirror-editor";

// BUG (annoyance): a caret at column 0 of a definition that the lint moves to
// the note's very first line landed on the next definition's label. With
// "[^2]: b", "    more", "[^1]: a" above "x[^1] y[^2]" and Move to bottom off,
// the caret on "[^1]: a" ended on "[^2]: b".
//
// What the user sees now: the caret stays with its text, at column 0 of
// "[^1]: a", now on the first line.
//
// The step that follows a caret to its definition put it at the note's start,
// where it belongs. The next step then took it for a caret that was already
// there when lines went in above the first line, and moved it below them. That
// step now asks where the carets were before the edits.
//
// Hunt 2026-11-06, cycle 10, press finding 4. Source of truth: Jason's ruling of
// 2026-11-05, pin spec-caret-in-swapped-definition: a caret in a definition the
// lint moves follows its text. Severity: annoyance. Origin: regression from
// 1a312e0. These tests run the real write-back on a real CodeMirror state.

/** Where the caret lands, as its line's text and its column, and how often the selection was set, after the lint from a caret at `line` and `ch` of `before`. */
function afterLint(before: string, line: number, ch: number, options: LintOptions = {}) {
    const lines = before.split("\n");
    const offset = lines.slice(0, line).join("\n").length + (line > 0 ? 1 : 0) + ch;
    const after = lintFootnotes(before, options);
    const pane = codeMirrorEditor(before, [{ anchor: offset, head: offset }]);
    replaceMinimal(pane.editor, before, after);
    expect(pane.text()).toBe(after);
    const place = pane.selections()[0].head;
    return { line: after.split("\n")[place.line], ch: place.ch, set: pane.selectionsSet() };
}

describe("a caret at column 0 of a definition that moves to the note's first line", () => {
    it("Move to bottom off, a reindex that moves it first", () => {
        expect(afterLint("[^2]: b\n    more\n[^1]: a\n\nx[^1] y[^2]", 2, 0, { moveDefinitionsToBottom: false })).toEqual({ line: "[^1]: a", ch: 0, set: 1 });
    });

    it("default settings, a note of definitions only", () => {
        expect(afterLint("[^2]: bb[^1]\n    more\n[^1]: aa", 2, 0)).toEqual({ line: "[^1]: aa", ch: 0, set: 1 });
    });

    it("control: a caret further into the line follows", () => {
        expect(afterLint("[^2]: b\n    more\n[^1]: a\n\nx[^1] y[^2]", 2, 3, { moveDefinitionsToBottom: false })).toEqual({ line: "[^1]: a", ch: 3, set: 1 });
    });

    it("control: a caret that was at the note's start stays on its line when a heading goes in above it", () => {
        expect(afterLint("[^1]: a\n[^2]: b", 0, 0, { sectionHeading: "# Footnotes" })).toMatchObject({ line: "[^1]: a", ch: 0 });
    });
});
