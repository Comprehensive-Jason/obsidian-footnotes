import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a copied selection that holds its own definition
// (Ctrl+A, or a paragraph taken together with its definition) is pasted
// raw into a note that already uses the same name, so the note ends up
// with two definitions of [^1].
//
// What the user would see: they copy a whole note, "a[^1]" with
// "[^1]: one", and paste it into a note that already has [^1]: uno. The
// paste lands untouched, a second [^1] definition appears, and one of the
// two footnotes now shows the other's text. The same text copied from
// another app is handled correctly: [^1] is renamed to [^2]. Only the
// plugin's own copy fares worse.
//
// Hunt 2026-10-02, round 1, lens carry-hook. Cluster C15.
//
// Source of truth: the README's Paste paragraph, "A clipboard that ends in
// definition lines, from anywhere (a copy you made by hand, or the Copy
// with Footnotes plugin), pastes the same way", and "the pasted footnotes
// come out unique with no setup".
//
// Cause: a definition that travels inside the selection is part of the
// body, not carried, so the copy has nothing to carry. On paste the
// register (the plugin's memory of its own last copy) matches the
// clipboard, finds no carried definitions, and handlePaste returns false.
// The editor then pastes the text as it is, and nothing checks the body's
// own definition against the destination. Text from another app skips the
// register and goes through the fallback, which splits the trailing
// definition off and renames it.

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
// to `to`.
function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("copy a selection that holds its own definition, paste where the name clashes", () => {
    it.fails("copy the whole note, paste into a note that already uses [^1]: the pasted footnote is renamed, not a duplicate [^1] definition", () => {
        const source = editor(["a[^1]", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 2, ch: 9 });
        const copy = clipboardEvent();
        handleCopy(fakePlugin(on, source), copy as never);
        // The editor's own copy writes the bare selection.
        const text = "a[^1]\n\n[^1]: one";
        const dest = editor(["x[^1]", "", "[^1]: uno"], { line: 0, ch: 5 });
        const event = clipboardEvent(text);
        const taken = handlePaste(fakePlugin(on, dest), event as never, dest);
        expect(taken).toBe(true);
        expect(dest.lines).toEqual(["x[^1]a[^2]", "", "[^1]: uno", "[^2]: one"]);
    });

    it("control: the same text arriving from another app is split and renamed", () => {
        // No copy came first, so the register is empty and the fallback
        // reads the trailing definition off the clipboard.
        const dest = editor(["x[^1]", "", "[^1]: uno"], { line: 0, ch: 5 });
        const taken = handlePaste(fakePlugin(on, dest), clipboardEvent("a[^1]\n\n[^1]: one") as never, dest);
        expect(taken).toBe(true);
        expect(dest.lines).toEqual(["x[^1]a[^2]", "", "[^1]: uno", "[^2]: one"]);
    });
});
