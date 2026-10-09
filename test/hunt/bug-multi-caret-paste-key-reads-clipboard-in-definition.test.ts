// BUG (annoyance): the paste-inline key with several carets, one of them
// in a footnote's text, reads the clipboard before it refuses.
//
// What the user would see: carets at the end of "[^1]: One." and at the end
// of "More text.", then the paste-inline key. The press is refused, rightly,
// but only after the clipboard was read; with an empty clipboard the only
// notice is "The clipboard is empty, so there is nothing to put in an inline
// footnote." instead of "No footnote was created: footnotes can't be nested
// inside other footnotes."
//
// Hunt 2026-10-09, cycle 8. Cluster V3, lens presses and selections.
// Source of truth: readInlineFootnoteFromClipboard's contract (a press that
// will be refused never touches the clipboard); the subtraction pass kept
// the single-caret paste key's guard for this reason (runs/sub-press).
// Origin: regression from 555bb25 (the subtraction pass took the caret
// guard out of the multi-caret press); green at 34d5377 and 3a47f7a.

// the paste key's multi-caret press
// reads the clipboard before refusing a caret inside a definition.
//
// The paste key ("insert inline footnote from the clipboard") with two
// Alt-clicked carets, one at the end of a definition's text. The press is
// refused, as it must be (a footnote inside a footnote, ADR 0001). The
// contract in inline-footnotes.ts (readInlineFootnoteFromClipboard):
// "Callers must run every guard BEFORE calling this, so that a press which
// will be refused never touches the clipboard at all." multi-caret.ts says
// the same of multiCaretPastePressHandled. The subtraction pass kept the
// single-caret paste key's definition guard for exactly this reason
// (runs/sub-press.report.md, "Candidates restored": "Without it, a refused
// press reads the clipboard, and with an empty clipboard the user gets 'The
// clipboard is empty' instead of the nesting notice"), but 555bb25 took the
// same guard out of multiCaretTargets, which the paste key's multi-caret
// press shares. At 3a47f7a the press was refused with the nesting notice
// before the clipboard was read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pasteInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { NestedFootnoteNotice } from "../../src/editor/notice";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

const settings = { ...DEFAULT_SETTINGS, enablePopupEditor: false };
const NOTE = ["Text[^1].", "", "[^1]: One.", "", "More text."];

let reads = 0;
function clipboard(text: string) {
    reads = 0;
    vi.stubGlobal("navigator", {
        clipboard: {
            readText: () => {
                reads++;
                return Promise.resolve(text);
            },
        },
    });
}

beforeEach(resetNotices);
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the paste key's multi-caret press with a caret at the end of a definition's text", () => {
    it.fails("is refused with the nesting notice without reading the clipboard", async () => {
        clipboard("Smith 2020");
        const doc = fakeEditor(NOTE, { carets: [{ line: 2, ch: 10 }, { line: 4, ch: 10 }], edits: true, wholeDoc: true, words: true });
        await pasteInlineFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(NOTE);
        expect(messages()).toEqual([NestedFootnoteNotice]);
        expect(reads).toBe(0);
    });

    it.fails("with an empty clipboard, still says why the press is refused (the nesting notice)", async () => {
        clipboard("");
        const doc = fakeEditor(NOTE, { carets: [{ line: 2, ch: 10 }, { line: 4, ch: 10 }], edits: true, wholeDoc: true, words: true });
        await pasteInlineFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(NOTE);
        expect(messages()).toEqual([NestedFootnoteNotice]);
    });

    it("control: the single-caret paste key on the blank line inside a definition refuses before reading the clipboard", async () => {
        clipboard("");
        const note = ["Text[^1].", "", "[^1]: One.", "", "    Two.", "", "More text."];
        const doc = fakeEditor(note, { cursor: { line: 3, ch: 0 }, edits: true, wholeDoc: true, words: true });
        await pasteInlineFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(note);
        expect(messages()).toEqual([NestedFootnoteNotice]);
        expect(reads).toBe(0);
    });
});
