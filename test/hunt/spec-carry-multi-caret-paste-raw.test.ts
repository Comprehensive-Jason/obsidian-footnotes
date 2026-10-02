import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: what should a paste that carries footnotes do when the
// editor has several carets (or the caret is in a table cell)?
//
// What it does now: handlePaste reads the clipboard, finds definitions to
// carry, then sees more than one caret and steps aside without a word.
// The editor pastes the clipboard text as it is at every caret, so each
// caret gets the text plus the raw "[^7]: seven" definition line.
// What a user might expect: either the paste is landed properly, or the
// definition lines are left off, or at least a toast says why the
// footnotes were not handled.
// Why it is a question and not a bug: landing one set of definitions for
// several carets has no obvious right answer (one definition shared by
// every pasted copy, or one per caret, renamed), and declining is a
// deliberate, safe choice. Only the silence is in doubt. Needs a live
// check too: the fake editor cannot show what Obsidian's own multi-caret
// paste does with the text.
//
// Hunt 2026-10-02, round 1, lens carry-hook. Cluster C21.
//
// Source of truth: the README's Paste paragraph ("Paste inside Obsidian
// strips those lines back off and lands the text and the definitions")
// and handlePaste's own early return for more than one selection.

// A stand-in for the browser's clipboard event: it reads `text` and
// records what the plugin writes back.
function clipboardEvent(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (type: string) => (type === "text/plain" ? text : ""),
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

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a multi-caret paste of text that carries a definition", () => {
    it.fails("is not left to paste the definition lines as plain text at every caret without a word", () => {
        // Two carets, one at the end of each line.
        const dest = fakeEditor(["a", "b"], { wholeDoc: true, edits: true, carets: [{ line: 0, ch: 1 }, { line: 1, ch: 1 }] });
        const taken = handlePaste(fakePlugin(on, dest), clipboardEvent("c[^7]\n\n[^7]: seven") as never, dest);
        // Either taken over, or at least a word about why the definitions
        // were not landed. Today: not taken, and no toast.
        expect(taken || messages().length > 0).toBe(true);
    });
});
