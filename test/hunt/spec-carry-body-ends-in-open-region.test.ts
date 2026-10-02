import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carriedInputHandler, handleCopy, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: when a copied selection ends inside a code block (or an
// open comment or math block), where should the carried definitions go in
// the clipboard text?
//
// What it does now: the selection runs from "a[^1]" into the middle of a
// code block, so the copied text ends inside a fence that is never
// closed. Copy appends the definition after a blank line anyway, which
// puts it INSIDE that open code block. A paste in the same window still
// works, because it uses the plugin's memory of the copy. But the phone
// keyboard route reads only the clipboard text, sees the definition as
// code, finds nothing to carry, and the text lands raw. Pasted into
// another app, the definition shows as part of the code.
// What a user might expect: the definition arrives as a definition on
// every route, for example by closing the open fence before the
// definitions, or by leaving the definitions off the clipboard text.
// Why it is a question and not a bug: the clipboard text is the selection
// as the user made it. Closing their fence adds text they did not select,
// and dropping the definitions breaks the README's promise that copy
// "puts the selection and the definitions its footnotes need into the
// clipboard text". Which trade-off wins is Jason's call.
//
// Hunt 2026-10-02, round 1, lens carry-clip. Cluster C11.
//
// Source of truth: the README, "On a phone, text pasted from the
// keyboard's clipboard history lands the same way", and splitCarriedText's
// docstring, which calls it "the mirror of withCarriedText".

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

describe("spec question: a copy whose selection ends inside a code block, pasted from a phone keyboard", () => {
    // The phone route: a keyboard's clipboard history commits the text
    // through the input method (the system that turns key presses into
    // text) instead of firing a paste event, so carriedInputHandler sees
    // it and returns whether it took the text over.
    it.fails("3b: lands as a paste would, not as plain text", () => {
        // The selection runs from the start of the note to the end of
        // "code", inside the fence.
        const source = editor(["a[^1]", "```", "code", "```", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 2, ch: 4 });
        const copy = clipboardEvent();
        handleCopy(fakePlugin(on, source), copy as never);
        const text = copy.written["text/plain"];
        // The definition is written after the unclosed fence, so it is
        // inside it.
        expect(text).toBe("a[^1]\n```\ncode\n\n[^1]: one");
        const doc = editor(["p"], { line: 0, ch: 1 });
        const handle = carriedInputHandler(fakePlugin(on, doc), () => doc);
        const at = doc.posToOffset({ line: 0, ch: 1 });
        expect(handle({} as never, at, at, text)).toBe(true);
    });
});
