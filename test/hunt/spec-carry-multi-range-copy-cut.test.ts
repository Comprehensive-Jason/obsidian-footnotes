import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { resetNotices } from "../helpers/notices";
import FootnotePlugin from "../../src/main";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: should a copy or cut of several selections at once
// (Alt-click or Ctrl-click to add ranges) carry their footnotes?
//
// What it does now: the hooks step aside whenever there is more than one
// selection, and the editor's own copy or cut runs. The references
// travel bare, and a cut leaves their definitions behind in the note with
// nothing pointing at them. No toast says so.
// What a user might expect: the definitions come along as they do for a
// single selection, or at least a toast says why they did not.
// Why it is a question and not a bug: CodeMirror joins several ranges
// with line breaks when it copies them, so where the definitions should
// go, and how a paste would split them back apart, has no obvious answer.
// Declining is a deliberate, safe choice; only the silence is in doubt.
// The paste side asks the same question for several carets
// (spec-carry-multi-caret-paste-raw).
//
// Hunt 2026-10-02, round 3, lens carry-terrain. Cluster T5.
//
// Source of truth: README, "Copy puts the selection and the definitions
// its footnotes need into the clipboard text" and "Cut takes the
// definitions that nothing else in the note uses along with the text".
// No exception for several selections is written down;
// carryableSelection's docstring returns null for "the selection is
// empty or multiple".

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

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: several selections at copy and cut time", () => {
    it.fails("a two-range cut whose ranges hold the only references takes their definitions along", () => {
        const doc = fakeEditor(["a[^1] b", "c[^2] d", "", "[^1]: one", "[^2]: two"], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        // two selections: each whole prose line, one reference in each
        Object.assign(doc, {
            listSelections: () => [
                { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 7 } },
                { anchor: { line: 1, ch: 0 }, head: { line: 1, ch: 7 } },
            ],
        });
        const plugin = {
            app: { workspace: { getActiveViewOfType: () => ({ editor: doc }) }, vault: {} },
            settings: { carryFootnotesOnCopy: true },
        } as unknown as FootnotePlugin;
        const event = clipboardEvent();
        handleCut(plugin, event as never);
        // Today: the hook writes nothing and leaves the cut to the editor
        expect(event.written["text/plain"] ?? "").toContain("[^1]: one");
    });
});
