import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { replaceMinimal } from "../../src/editor/write-back";
import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";
import { codeMirrorEditor } from "../helpers/codemirror-editor";

// Scenario: two carets, or a selection and a caret, sit inside one
// definition (as after Ctrl+D on a repeated word in a footnote), and the
// lint moves that definition: gathers it to the bottom, or reindex swaps
// it with another.
//
// What the user saw: one caret, at column 0 of the prose line that was
// under the definition, or of the other footnote's label line on a swap,
// so the next keystroke went there. The move is a deletion and an
// insertion, so the editor carried every caret in the block to the
// deletion point and merged them into one, and the write-back, seeing
// fewer selections than before, left them as the editor put them.
//
// Ruling: a caret in a definition the lint moves follows its text (Jason,
// 2026-11-05, pin spec-caret-in-swapped-definition); the triage of
// 2026-11-06 chose that this holds for each of several carets in one
// definition too. The write-back now works out for itself where the
// editor carried each selection, through CodeMirror's own change mapping,
// so the selections pair up whatever the editor merged.
//
// Hunt 2026-11-06, cycle 9, finding H35. Severity: annoyance. Origin:
// pre-existing (the caret-following of 2026-11-05 fixed the one-caret case
// only). These tests run the real write-back on a real CodeMirror state.

type Pos = { line: number; ch: number };
type Range = { anchor: Pos; head: Pos };

const caret = (line: number, ch: number): Range => ({ anchor: { line, ch }, head: { line, ch } });

/** The selections after the lint turns `before` into its result through the write-back, starting from `ranges`, as [line text, column] pairs, and how often the selection was set. */
function afterLint(before: string, ranges: Range[], options: LintOptions = {}) {
    const after = lintFootnotes(before, options);
    const lines = before.split("\n");
    const offset = (pos: Pos) => lines.slice(0, pos.line).join("\n").length + (pos.line > 0 ? 1 : 0) + pos.ch;
    const pane = codeMirrorEditor(before, ranges.map((range) => ({ anchor: offset(range.anchor), head: offset(range.head) })));
    replaceMinimal(pane.editor, before, after);
    expect(pane.text()).toBe(after);
    const b = after.split("\n");
    const at = (pos: Pos) => [b[pos.line], pos.ch] as const;
    return {
        carets: pane.selections().map((range) => at(range.head)),
        ranges: pane.selections().map((range) => [...at(range.anchor), ...at(range.head)]),
        set: pane.selectionsSet(),
    };
}

describe("several carets in one definition the lint moves to the bottom", () => {
    it("two carets on two lines of the definition: both follow", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n    second\n\nPara two.";
        expect(afterLint(before, [caret(2, 8), caret(3, 6)]).carets).toEqual([
            ["[^1]: my note", 8],
            ["    second", 6],
        ]);
    });

    it("two carets on a one-line definition: both follow", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n\nPara two.";
        expect(afterLint(before, [caret(2, 6), caret(2, 10)]).carets).toEqual([
            ["[^1]: my note", 6],
            ["[^1]: my note", 10],
        ]);
    });

    it("a selection and a caret: both follow, the selection with both ends", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n    second\n\nPara two.";
        expect(afterLint(before, [{ anchor: { line: 2, ch: 6 }, head: { line: 2, ch: 8 } }, caret(3, 6)]).ranges).toEqual([
            ["[^1]: my note", 6, "[^1]: my note", 8],
            ["    second", 6, "    second", 6],
        ]);
    });

    it("two carets in the definition and one on the prose: the two follow, the prose one stays on its text", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n    second\n\nPara two.";
        expect(afterLint(before, [caret(2, 8), caret(3, 6), caret(5, 4)]).carets).toEqual([
            ["Para two.", 4],
            ["[^1]: my note", 8],
            ["    second", 6],
        ]);
    });

    it("two carets in each of two definitions gathered together: all four follow", () => {
        const before = "Para one.[^1]\n\n[^1]: one note\n    more one\n\nPara two.[^2]\n\n[^2]: two note\n    more two\n\nPara three.";
        expect(afterLint(before, [caret(2, 7), caret(3, 6), caret(7, 7), caret(8, 6)]).carets).toEqual([
            ["[^1]: one note", 7],
            ["    more one", 6],
            ["[^2]: two note", 7],
            ["    more two", 6],
        ]);
    });
});

describe("several carets in one definition reindex swaps", () => {
    it("two carets in the swapped definition: both follow its text", () => {
        const before = "See[^2] then[^1]\n\n[^1]: one\n    cont one\n[^2]: two\n    cont two";
        expect(lintFootnotes(before, {}).split("\n")).toEqual(["See[^1] then[^2]", "", "[^1]: two", "    cont two", "[^2]: one", "    cont one"]);
        expect(afterLint(before, [caret(2, 8), caret(3, 9)]).carets).toEqual([
            ["[^2]: one", 8],
            ["    cont one", 9],
        ]);
    });
});

describe("what stays as it was", () => {
    it("two carets on prose, none in a definition: the editor's own carrying, no selection set", () => {
        const before = "Para one.[^1]\n\n[^1]: my note\n\nPara two.";
        const { carets, set } = afterLint(before, [caret(0, 4), caret(4, 4)]);
        expect(carets).toEqual([
            ["Para one.[^1]", 4],
            ["Para two.", 4],
        ]);
        expect(set).toBe(0);
    });

    it("two carets the editor merges on a deleted definition stay merged, with no selection set", () => {
        const before = "Para one.[^1]\n\nPara two.\n\n[^1]: my note\n\n[^9]: no reference";
        const options = { removeOrphanedDefinitions: true };
        const { carets, set } = afterLint(before, [caret(6, 4), caret(6, 8)], options);
        expect(carets).toHaveLength(1);
        expect(set).toBe(0);
    });

    it("the editor carried a lone caret right: no selection set", () => {
        const before = "A[^2] B[^1]\n\n[^2]: two\n[^1]: one";
        const { carets, set } = afterLint(before, [caret(2, "[^2]: tw".length)]);
        expect(carets).toEqual([["[^1]: two", "[^1]: tw".length]]);
        expect(set).toBe(0);
    });
});

// ---------- property: every caret in a moved definition follows it, beside a caret on prose ----------

const BODIES = ["Ibid.", "my note", "see page 5"];

/** A structured note: prose lines each citing one footnote, the definitions (some with continuation lines) in a random order, mid-note or at the end. */
const noteArb = fc
    .integer({ min: 1, max: 5 })
    .chain((count) => {
        const names = Array.from({ length: count }, (_, i) => String(i + 1));
        return fc.record({
            refOrder: fc.shuffledSubarray(names, { minLength: count, maxLength: count }),
            defOrder: fc.shuffledSubarray(names, { minLength: count, maxLength: count }),
            bodies: fc.array(fc.constantFrom(...BODIES), { minLength: count, maxLength: count }),
            conts: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: count, maxLength: count }),
            midNote: fc.boolean(),
        });
    })
    .map(({ refOrder, defOrder, bodies, conts, midNote }) => {
        const prose = refOrder.map((n, i) => `Paragraph ${String(i + 1)} says things.[^${n}]`);
        const definitions = defOrder.map((n) => {
            const k = Number(n) - 1;
            return [`[^${n}]: ${bodies[k]}`, ...Array.from({ length: conts[k] }, (_, j) => `    more ${String(j + 1)}`)];
        });
        const defLines = definitions.flatMap((d) => [...d, ""]);
        const lines = midNote ? [prose[0], "", ...defLines, ...prose.slice(1).flatMap((p) => [p, ""]), "Closing line."] : [...prose.flatMap((p) => [p, ""]), ...defLines, "Closing line."];
        return { before: lines.join("\n"), refOrder };
    });

/** The definitions of `text` with the lines each spans and where its label ends. */
function definitionBlocks(text: string) {
    return readNote(text.split("\n")).definitions.map((d) => ({ name: d.name, start: d.start, end: d.end, labelEnd: d.labelEnd }));
}

describe("property: two carets in one definition and one on prose all land right", () => {
    it("each caret in the definition keeps its place in the definition's text, the prose caret keeps its line and column", () => {
        fc.assert(
            fc.property(noteArb, fc.nat(), fc.nat(), fc.nat(), fc.nat(), fc.nat(), fc.nat(), ({ before, refOrder }, pickDef, pickLineA, pickChA, pickLineB, pickChB, pickProse) => {
                const after = lintFootnotes(before, {});
                const a = before.split("\n");
                const defsBefore = definitionBlocks(before);
                const def = defsBefore[pickDef % defsBefore.length];
                // a place inside the definition: on its label line after the label, or anywhere on a continuation line
                const placeIn = (pickLine: number, pickCh: number) => {
                    const line = def.start + (pickLine % (def.end - def.start + 1));
                    const ch = line === def.start ? def.labelEnd + (pickCh % (a[line].length - def.labelEnd + 1)) : pickCh % (a[line].length + 1);
                    return { line, ch };
                };
                const first = placeIn(pickLineA, pickChA);
                const second = placeIn(pickLineB, pickChB);
                fc.pre(first.line !== second.line || first.ch !== second.ch);
                const prose = a.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith("Paragraph") || l === "Closing line.");
                const [proseText, proseLine] = prose[pickProse % prose.length];
                const sorted = [first, second].sort((p, q) => p.line - q.line || p.ch - q.ch);
                const { carets } = afterLint(before, [...sorted.map((p) => caret(p.line, p.ch)), caret(proseLine, 4)]);
                // where the footnote's definition is now, by the name the reference order gives it
                const newName = String(refOrder.indexOf(def.name) + 1);
                const target = definitionBlocks(after).find((d) => d.name === newName);
                expect(target).toBeDefined();
                const b = after.split("\n");
                const expected = (p: { line: number; ch: number }) => {
                    const line = (target?.start ?? 0) + (p.line - def.start);
                    return [b[line], p.line === def.start ? p.ch + ((target?.labelEnd ?? 0) - def.labelEnd) : p.ch] as const;
                };
                const wanted = [...sorted.map(expected), [proseText, 4] as const];
                const sortKey = (c: readonly [string, number]) => `${c[0]}\u0000${String(c[1]).padStart(4, "0")}`;
                const plain = (c: readonly [string, number]) => [c[0].replace(/\[\^[^\]]*\]/g, ""), c[1]] as const;
                expect(carets.map(plain).map(sortKey).sort()).toEqual(wanted.map(plain).map(sortKey).sort());
            }),
            { numRuns: Number(process.env.FC_NUM_RUNS ?? 300) },
        );
    });
});
