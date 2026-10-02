import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: Ctrl+X with only a caret (nothing selected) cuts the
// whole line in Obsidian. Should that line take along the definitions
// that nothing else in the note uses, as a cut of the same line selected
// by hand does?
//
// What it does now: the note is "See[^1] here", "", "[^1]: one", with
// the caret inside the first line and nothing selected. The cut hook
// returns at once on an empty selection, so CodeMirror (the editor
// inside Obsidian) does its own "line-wise" cut: it deletes the line
// together with its line break and puts the line's text in the
// clipboard. The definition "[^1]: one" stays behind in the note, where
// nothing references this footnote any more, and the clipboard holds no
// definition. Ctrl+C with only a caret copies the line the same way, also
// without its definition.
// What a user might expect: the same as selecting "See[^1] here" and
// cutting it: the clipboard carries "[^1]: one" after the line, and the
// definition leaves the note.
// Why it is a question and not a bug: the plugin bails on an empty
// selection on purpose, and an existing test pins that ("does nothing
// while the feature is off, or with nothing selected", in
// test/carry-footnotes-hooks.test.ts). Taking a line-wise cut over has a
// cost: CodeMirror remembers a line-wise copy and, when the clipboard
// still matches it, pastes it as a whole line above the caret's line. A
// clipboard the plugin rewrites no longer matches, so the paste would
// land at the caret instead. Jason decides whether carrying is worth
// that.
//
// Hunt 2026-10-02, round 1, lens carry-clip. Cluster C29.
//
// Source of truth: @codemirror/view, copiedRange: "Nothing selected, do
// a line-wise copy", used for copy and cut alike. The clipboard text is
// the line itself; the range deleted is the line plus its line break.
// The README: "Cut takes the definitions that nothing else in the note
// uses along with the text".

/** A stand-in for the browser's clipboard event: it records what the hook writes and whether the hook took the event over. */
function clipboardEvent() {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: () => "",
            setData: (type: string, value: string) => {
                event.written[type] = value;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

/** A fake editor holding `lines`, with only a caret at `at` (an empty selection). */
function editor(lines: string[], at: { line: number; ch: number }) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: Ctrl+X with only a caret cuts the whole line", () => {
    it.fails("takes the definition the line alone used", () => {
        const source = editor(["See[^1] here", "", "[^1]: one"], { line: 0, ch: 3 });
        const cut = clipboardEvent();
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, source), cut as never);
        // The plugin takes the cut over instead of leaving it to CodeMirror.
        expect(cut.defaultPrevented).toBe(true);
        // The clipboard starts with the line, as CodeMirror's own line-wise
        // cut would, and carries the definition after it.
        const clipboard = cut.written["text/plain"] ?? "";
        expect(clipboard.startsWith("See[^1] here")).toBe(true);
        expect(clipboard).toContain("[^1]: one");
        // Neither the line nor its definition is left in the note.
        expect(source.lines.join("\n")).not.toContain("See[^1] here");
        expect(source.lines.join("\n")).not.toContain("[^1]: one");
    });
});
