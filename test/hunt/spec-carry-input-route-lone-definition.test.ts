import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carriedInputHandler, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: should a lone definition line, "[^n]: n" with no line
// break, be landed as a footnote when it arrives from a phone keyboard's
// clipboard history, the way a desktop paste lands it?
//
// What it does now: a desktop paste of "[^n]: n" is taken over, and the
// definition is added where a new footnote's definition would go. The
// same text committed from a phone keyboard's clipboard history is left
// to the editor, which types it in at the caret as plain text.
// What a user might expect: the README says text from the clipboard
// history "lands the same way" as a paste, so both routes should agree.
// Why it is a question and not a bug: carriedInputHandler looks only at
// inserted text that spans lines on purpose. Every typed character and
// every autocorrect also passes through the input method, and a
// one-line insert is far more likely to be typing than a paste. Whether
// to widen that check, at the risk of grabbing typed text, is Jason's
// call.
//
// Hunt 2026-10-02, round 1, lens carry-reg. Cluster C33.
//
// Source of truth: the README, "On a phone, text pasted from the
// keyboard's clipboard history lands the same way", and
// carriedInputHandler's docstring ("looks at any inserted text that spans
// lines and ends in definition lines").

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

// A fake editor holding `lines`, with the selection running from `from`
// to `to` (the same place when nothing is selected).
function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a lone definition line through the paste route and the phone keyboard route", () => {
    it.fails("the input method route lands a lone definition line the way the paste route does", () => {
        const viaPaste = editor(["a[^x]", "", "[^x]: x", "", "tail"], { line: 4, ch: 4 });
        handlePaste(fakePlugin(on, viaPaste), clipboardEvent("[^n]: n") as never, viaPaste);
        // The phone route: a keyboard's clipboard history commits the text
        // through the input method (the system that turns key presses
        // into text), so carriedInputHandler sees it instead.
        const viaInput = editor(["a[^x]", "", "[^x]: x", "", "tail"], { line: 4, ch: 4 });
        const handle = carriedInputHandler(fakePlugin(on, viaInput), () => viaInput);
        const at = viaInput.posToOffset({ line: 4, ch: 4 });
        if (!handle({} as never, at, at, "[^n]: n")) {
            // What CodeMirror does when the handler declines: insert the
            // text at the caret as typed.
            viaInput.transaction({ changes: [{ from: { line: 4, ch: 4 }, to: { line: 4, ch: 4 }, text: "[^n]: n" }] });
        }
        expect(viaInput.lines).toEqual(viaPaste.lines);
    });
});
