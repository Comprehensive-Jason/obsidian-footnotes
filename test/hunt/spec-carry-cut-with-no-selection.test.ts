import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";

// Ctrl+X with only a caret (nothing selected) cuts the whole line in Obsidian.
// Should that line take along the definitions that nothing else in the note
// uses, as a cut of the same line selected by hand does?
//
// Jason's ruling (2026-11-05, spec-sort entry 9): no. Ctrl+X with nothing
// selected keeps the editor's own cut, and the README says so. The note is "See[^1]
// here", "", "[^1]: one", with the caret inside the first line. The cut hook
// returns at once on an empty selection, so CodeMirror (the editor inside
// Obsidian) does its own "line-wise" cut: it deletes the line together with its
// line break and puts the line's text in the clipboard. The definition stays
// behind, where nothing references this footnote any more, and the lint alert
// names it. Nothing is lost.
//
// Why not take the cut over: CodeMirror remembers a line-wise copy and, when
// the clipboard still matches it, pastes it as a whole line above the caret's
// line. A clipboard the plugin rewrites no longer matches, so the paste would
// land at the caret instead.
//
// Hunt 2026-10-02, round 1, lens carry-clip. Cluster C29.
//
// Source of truth: Jason's ruling above, and @codemirror/view, copiedRange:
// "Nothing selected, do a line-wise copy", used for copy and cut alike. The
// clipboard text is the line itself; the range deleted is the line plus its
// line break.

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

describe("Ctrl+X with only a caret keeps the editor's own cut", () => {
    it("the plugin leaves the cut to the editor: no clipboard text, no edit, no toast", () => {
        const lines = ["See[^1] here", "", "[^1]: one"];
        const source = editor(lines, { line: 0, ch: 3 });
        const cut = clipboardEvent();
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, source), cut as never);
        expect(cut.defaultPrevented).toBe(false);
        expect(cut.written).toEqual({});
        expect(source.transactions).toBe(0);
        expect(source.lines).toEqual(lines);
        expect(messages()).toEqual([]);
    });

    it("the definition stays behind, and the lint alert names it", () => {
        // The note as the editor's own cut leaves it: the line and its line
        // break are gone, and the definition is still there. The default
        // settings keep an orphaned definition and alert about it.
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), ["", "[^1]: one"].join("\n"));
        expect(messages()).toEqual(['This note has a footnote definition nothing references ("[^1]"). Add a "[^1]" reference in the text, or delete the definition.']);
    });
});
