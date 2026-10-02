import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownView } from "obsidian";

import { fakeEditor } from "../helpers/fake-editor";
import { replaceMinimal } from "../../src/editor/write-back";

// spec question: when a rewrite changes text to the LEFT of a second
// pane's caret on the same line, should that caret move with its text?
//
// What it does now: with the same note open in two panes, a rewrite in
// one pane (a cut on that line, or a lint renumbering [^10] to [^9])
// puts the other pane's caret back on the same line at the same column
// it had before. The text to its left got shorter, so the caret now sits
// somewhere else in the line. In this test the other pane's caret was
// before "gamma"; the cut removes "[^1]" to its left, and the caret comes
// back four characters further along, just before gamma's last letter.
// What a user might expect: the caret stays before "gamma", the way the
// caret in the pane they are working in does (CodeMirror carries that one
// through the edit).
// Why it is a question and not a bug: the second-pane restore (commit
// fb05027) was built to stop that pane's caret jumping to the top of the
// note, and it does. Carrying it by line was the chosen precision, the
// same line alignment the folds use; carrying the column too is a step
// further that Jason has not asked for.
//
// Hunt 2026-10-02, round 1, lens carry-reg. Cluster C35.
//
// Source of truth: commit fb05027, "A second pane on the same note stays
// where it was after a lint, a delete, a conversion, or a carried paste",
// and restoreOtherPanes in src/editor/write-back.ts, which maps the
// caret's line through lineMapper and keeps its old column.

type Pos = { line: number; ch: number };

// A stand-in for the second pane's editor: it reads the note's shared
// text, starts with its caret at `caret`, and records where the restore
// puts the caret back.
function otherPane(text: { value: string }, caret: Pos) {
    const placed: { anchor?: Pos; head?: Pos } = {};
    const editor = {
        getCursor: () => caret,
        getScrollInfo: () => ({ top: 0, left: 0 }),
        getValue: () => text.value,
        lastLine: () => text.value.split("\n").length - 1,
        getLine: (n: number) => text.value.split("\n")[n],
        setSelection: (anchor: Pos, head: Pos) => {
            placed.anchor = anchor;
            placed.head = head;
        },
        scrollTo() {},
    };
    return { editor, placed };
}

// A pane's view with the given fields. The real MarkdownView wants a
// workspace leaf to build, so this skips the constructor; the result still
// counts as a MarkdownView when the plugin checks for one.
function paneView<T extends object>(fields: T): MarkdownView & T {
    return Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, fields);
}

afterEach(() => {
    vi.useRealTimers();
});

describe("spec question: the other pane's caret column after a rewrite on its own line", () => {
    it.fails("a cut left of the other pane's caret moves that caret left with its text", () => {
        // The restore waits on timers, so the test runs a fake clock
        // and needs a global `window` for them to hang off.
        vi.useFakeTimers();
        (globalThis as { window?: unknown }).window ??= globalThis;
        const before = "Alpha [^1] beta gamma\n\n[^1]: one";
        const after = "Alpha  beta gamma";
        const doc = fakeEditor(before.split("\n"), { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        // The other pane's caret sits before "gamma" (ch 16).
        const shared = { value: before };
        const other = otherPane(shared, { line: 0, ch: 16 });
        const otherView = paneView({ file: { path: "n.md" }, editor: other.editor });
        const thisView: MarkdownView = paneView({
            file: { path: "n.md" },
            editor: doc,
            app: { workspace: { getLeavesOfType: () => [{ view: thisView }, { view: otherView }] } },
        });
        replaceMinimal(doc, before, after, thisView);
        // Obsidian copies the rewrite into the other pane a moment later.
        shared.value = after;
        vi.advanceTimersByTime(500);
        // -1 when the restore never placed the caret, which fails too.
        const ch = other.placed.head?.ch ?? -1;
        expect(after.slice(ch, ch + 5)).toBe("gamma");
    });
});
