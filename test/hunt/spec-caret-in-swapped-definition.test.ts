import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper, mapFoldLines } from "../../src/editor/document-diff";
import { replaceMinimal } from "../../src/editor/write-back";
import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { codeMirrorEditor } from "../helpers/codemirror-editor";

// Ruling (Jason, 2026-11-05, the spec pin sort, entry 7, option a): a caret
// in a definition the lint moves follows its text, wherever the definition
// goes. That covers a definition gathered at the bottom of the note and
// reindex's slot swap. It replaces question Q21 of the result gate design
// (2026-10-07, ADR 0003), which had left the swap's caret alone.
//
// What the user saw before: a footnote written by hand mid-note, the caret
// at the end of its text, and Ctrl+S. The default lint gathered the
// definition at the bottom, and the caret landed at column 0 of "Para two.",
// the paragraph that was under the definition, so the next keystroke went
// into the prose. A fold and a second pane already followed the text (the
// controls below).
//
// The "slot swap" is reindex's move: the definitions stay in their places
// ("slots") and their texts trade places so the order follows the
// references. A "fold" is a definition, list item, or heading collapsed
// with the arrow in the margin; the plugin puts every fold back after a
// lint.
//
// The lint's edits stay small, so a caret on the line being typed stays put
// (pin bug-caret-below-moved-definitions). The write-back moves the caret
// itself once the edits are in. So these tests run the real write-back on a
// real CodeMirror state.
//
// Hunt 2026-10-06, cycle 5, lens diff, cluster X19; hunt 2026-10-08, cycle
// 6, cluster Z21.
//
// Origin: pre-existing.

/** The line where definition `name` starts in `text`. */
const labelLine = (text: string, name: string) => text.split("\n").findIndex((l) => l.startsWith(`[^${name}]:`));

/** A caret at `line`, `ch`, as an empty selection. */
const caret = (line: number, ch: number) => ({ anchor: { line, ch }, head: { line, ch } });

/** The selections after the lint turns `before` into its result through the write-back, starting from `ranges`. */
function afterLint(before: string, ranges: ReturnType<typeof caret>[], options: LintOptions = {}) {
    const after = lintFootnotes(before, options);
    const lines = before.split("\n");
    const offset = (pos: { line: number; ch: number }) => lines.slice(0, pos.line).join("\n").length + (pos.line > 0 ? 1 : 0) + pos.ch;
    const pane = codeMirrorEditor(before, ranges.map((range) => ({ anchor: offset(range.anchor), head: offset(range.head) })));
    replaceMinimal(pane.editor, before, after);
    expect(pane.text()).toBe(after);
    return pane.selections();
}

describe("reindex's slot swap", () => {
    const before = ["See[^2] then[^1]", "", "[^1]: one", "    cont one", "[^2]: two", "    cont two"].join("\n");

    it("control: the lint swaps the texts between the slots", () => {
        const after = lintFootnotes(before, {});
        expect(after.split("\n")).toEqual(["See[^1] then[^2]", "", "[^1]: two", "    cont two", "[^2]: one", "    cont one"]);
    });

    it("control: a fold on each definition follows its text", () => {
        const after = lintFootnotes(before, {});
        const changes = lineDiffChanges(before, after);
        expect(mapFoldLines([{ from: 2, to: 3 }], changes, before)).toEqual([{ from: labelLine(after, "2"), to: labelLine(after, "2") + 1 }]);
        expect(mapFoldLines([{ from: 4, to: 5 }], changes, before)).toEqual([{ from: labelLine(after, "1"), to: labelLine(after, "1") + 1 }]);
    });

    it("control: another pane's caret on each definition line follows its text", () => {
        const after = lintFootnotes(before, {});
        const map = lineMapper(lineDiffChanges(before, after), before);
        expect([2, 3, 4, 5].map(map)).toEqual([4, 5, 2, 3]);
    });

    // This test used to pin the old behaviour as the design's answer: the
    // caret landed at column 0 of "[^1]: two". The ruling of 2026-11-05
    // replaces that.
    it("the editor's caret at the end of 'cont one' follows its text", () => {
        expect(afterLint(before, [caret(3, "    cont one".length)])).toEqual([caret(5, "    cont one".length)]);
    });

    it("the editor's caret in the text on a label line follows its text", () => {
        expect(afterLint(before, [caret(2, "[^1]: o".length)])).toEqual([caret(4, "[^2]: o".length)]);
    });

    it("a selection inside one definition follows its text, both ends", () => {
        const selection = { anchor: { line: 3, ch: 4 }, head: { line: 3, ch: 8 } };
        expect(afterLint(before, [selection])).toEqual([{ anchor: { line: 5, ch: 4 }, head: { line: 5, ch: 8 } }]);
    });
});

describe("the move to the bottom, with the caret in the gathered definition", () => {
    const Cases = [
        { what: "a one-line definition", before: "Para one.[^1]\n\n[^1]: my note\n\nPara two.", line: 2, text: "[^1]: my note" },
        { what: "a definition over two lines", before: "Para one.[^1]\n\n[^1]: my note\n    second line\n\nPara two.", line: 3, text: "    second line" },
    ];
    for (const { what, before, line, text } of Cases) {
        it(`control (${what}): the lint moves it, and a second pane on that line follows it`, () => {
            const after = lintFootnotes(before, {});
            const b = after.split("\n");
            expect(b.indexOf(text)).toBeGreaterThan(line);
            expect(lineMapper(lineDiffChanges(before, after), before)(line)).toBe(b.indexOf(text));
        });

        it(`${what}: the editor's caret at the end of the line follows it too`, () => {
            const after = lintFootnotes(before, {});
            const b = after.split("\n");
            expect(afterLint(before, [caret(line, text.length)])).toEqual([caret(b.indexOf(text), text.length)]);
        });
    }

    it("a renumbered label shorter than before: the caret keeps its place in the text", () => {
        const before = "Para one.[^10]\n\n[^10]: my note\n\nPara two.";
        expect(lintFootnotes(before, {}).split("\n")).toEqual(["Para one.[^1]", "", "Para two.", "", "[^1]: my note"]);
        expect(afterLint(before, [caret(2, "[^10]: my".length)])).toEqual([caret(4, "[^1]: my".length)]);
    });

    it("an empty definition being filled in: the caret stays after its label", () => {
        const before = "Para one.[^1]\n\n[^1]: \n\nPara two.";
        expect(lintFootnotes(before, {}).split("\n")).toEqual(["Para one.[^1]", "", "Para two.", "", "[^1]: "]);
        expect(afterLint(before, [caret(2, "[^1]: ".length)])).toEqual([caret(4, "[^1]: ".length)]);
    });

    it("two carets, one in the definition and one on the prose: each keeps its own text", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n\nPara two.";
        expect(afterLint(before, [caret(2, "[^1]: my".length), caret(4, "Para".length)])).toEqual([caret(2, "Para".length), caret(4, "[^1]: my".length)]);
    });
});

// The ruling is about a caret in the text of a definition that moves. These
// hold the places it does not reach.
describe("what the caret-following leaves as the editor carries it", () => {
    const note = "Para one.[^1]\n\n[^1]: my note\n\nPara two.";

    it("a caret on prose stays on its line", () => {
        expect(afterLint(note, [caret(4, "Para two.".length)])).toEqual([caret(2, "Para two.".length)]);
    });

    it("a caret in a definition the lint leaves in place stays", () => {
        const before = "Para one.[^1]\n\nPara two.\n\n[^1]: my note\n\n[^9]: no reference";
        expect(afterLint(before, [caret(4, "[^1]: my".length)])).toEqual([caret(4, "[^1]: my".length)]);
    });

    it("a selection that runs out of the definition is not followed", () => {
        const selection = { anchor: { line: 2, ch: 6 }, head: { line: 4, ch: 4 } };
        const [range] = afterLint(note, [selection]);
        // the definition's text left the selection, and the editor's own
        // carrying decides what is left of it
        expect(range.head.line).not.toBe(4);
    });

    it("a caret in a definition the lint deletes stays where the editor carries it", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n\n[^9]: no reference\n\nPara two.";
        const [range] = afterLint(before, [caret(4, "[^9]: no".length)], { removeOrphanedDefinitions: true });
        expect(lintFootnotes(before, { removeOrphanedDefinitions: true })).not.toContain("[^9]");
        expect(range.head.ch).toBe(0);
    });

    it("a caret at the very start of the note stays on its own line when a heading goes in above", () => {
        const before = "[^1]: alpha\n\nSee[^1].";
        const [range] = afterLint(before, [caret(0, 0)], { sectionHeading: "# Footnotes" });
        const lines = lintFootnotes(before, { sectionHeading: "# Footnotes" }).split("\n");
        expect(lines[range.head.line]).toBe("[^1]: alpha");
        expect(range.head.ch).toBe(0);
    });
});
