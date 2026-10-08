import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper, mapFoldLines } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// spec question: when the lint puts the definitions in reference order by
// swapping their texts between two places, should the editor's caret in
// one of them follow its text, as a fold and a second pane already do?
//
// What it does now: "See[^2] then[^1]", then "[^1]: one" with a second
// line "cont one", then "[^2]: two" with a second line "cont two". The
// user is typing at the end of "cont one" and saves. The lint renumbers
// the references and swaps the texts, so "one" and "cont one" move down to
// the [^2] place. The caret lands at column 0 of "[^1]: two", the first
// definition. A fold on either definition, and a second pane's caret on
// any of their lines, follow the text (the two controls below).
// What a user might expect: the caret stays at the end of "cont one", now
// the second line of [^2]'s definition, as the fold and the second pane
// do.
// Why it is a question and not a bug: the caret sits in a definition the
// lint moved (and, in the swap, renamed), so the manual sheet's promise
// for "an unchanged line" does not cover it. The editor's caret rides on the lint's edits,
// which are left small on purpose so the caret on the line being typed
// stays put, while a fold and a second pane read a separate line map
// (findMovedDefinitions's comment in src/editor/document-diff.ts). Whether the editor's own
// caret should follow a moved definition, stay in its place, or go to the
// definition's label is a product decision for Jason. It is not narrow: a
// definition the move gathers to the bottom does it too, one line or more,
// which is the everyday way of writing a footnote by hand with lint on
// save (hunt 2026-10-08, cycle 6, cluster Z21, the second group below).
//
// The "slot swap" is reindex's move: the definitions stay in their places
// ("slots") and their texts trade places so the order follows the
// references. A "fold" is a definition, list item, or heading collapsed
// with the arrow in the margin; the plugin puts every fold back after a
// lint.
//
// Hunt 2026-10-06, cycle 5, lens diff. Cluster X19.
//
// Origin: pre-existing.
//
// Source of truth: manual sheet 12, "Lint triggers and settings page"
// ("every fold is still folded", "the caret is still where it was");
// findMovedDefinitions's contract (a definition the lint moved is found
// again by its name as the lint renamed it, so a fold on it follows it);
// lineMapper's contract (a line moved is still the same line).

/** The line where definition `name` starts in `text`. */
const labelLine = (text: string, name: string) => text.split("\n").findIndex((l) => l.startsWith(`[^${name}]:`));

/**
 * Where the editor puts a caret at (line, ch) of `before` once the lint's
 * edits are applied. CodeMirror carries the caret through the edits with
 * "assoc -1" (a caret where text is replaced goes to the start of the new
 * text), as it does when the plugin's Editor.transaction carries no
 * selection.
 */
function mapCaret(before: string, after: string, line: number, ch: number) {
    const changes = lineDiffChanges(before, after);
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

    // Now: the caret at the end of "    cont one" lands at column 0 of
    // "[^1]: two" (line 2).
    it.fails("spec question: the editor's caret at the end of 'cont one' follows that text to the [^2] slot", () => {
        const after = lintFootnotes(before, {});
        expect(mapCaret(before, after, 3, "    cont one".length)).toEqual({ line: 5, ch: "    cont one".length });
    });
});

// The cases below came from hunt cycle 6, cluster Z21. They show the same
// caret behaviour without any swap: the user is typing at the end of a
// definition in the middle of the note and saves, and the default lint
// gathers that definition at the bottom. The caret lands at column 0 of
// "Para two.", the paragraph that was under the definition, so the next
// keystroke goes into the user's prose. A second pane's caret on that line
// follows the definition (the controls).
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

        // Now: { line: 2, ch: 0 }, the start of "Para two."
        it.fails(`spec question (${what}): the editor's caret at the end of the line follows it too`, () => {
            const after = lintFootnotes(before, {});
            const b = after.split("\n");
            expect(mapCaret(before, after, line, text.length)).toEqual({ line: b.indexOf(text), ch: text.length });
        });
    }
});
