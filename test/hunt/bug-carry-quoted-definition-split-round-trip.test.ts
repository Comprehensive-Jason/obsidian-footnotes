import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carriedDefinitions, splitCarriedText, withCarriedText } from "../../src/commands/carry-footnotes";
import { carriedInputHandler, handleCopy, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a copy that carries a definition from inside a
// blockquote cannot be read back by the routes that have only the
// clipboard text to go on, so on a phone it pastes as plain text.
//
// What the user would see: their note keeps a definition inside a
// blockquote, "> [^1]: quoted". On their phone they copy the text that
// cites it, then paste it from the keyboard's clipboard history. The text
// lands with "> [^1]: quoted" stuck on after it as an ordinary line,
// instead of the definition going where a new footnote would go, which is
// what a desktop paste does. This is the symptom of Jason's phone finding
// of 2026-09-25, for this one shape. A paste in another Obsidian window
// fares the same.
//
// Hunt 2026-10-02, round 1, lens carry-clip. Cluster C10.
//
// Source of truth: the README, "On a phone, text pasted from the
// keyboard's clipboard history lands the same way", and splitCarriedText's
// docstring, which calls it "the mirror of withCarriedText".
//
// Cause: carriedDefinitions carries a quoted definition, and
// withCarriedText writes it to the clipboard with its "> " intact. But
// splitCarriedText finds definitions through findDefinitionBlocks, which
// only forms blocks for labels at column 0, so it never sees a quoted
// one. The phone route (carriedInputHandler) reads only splitCarriedText,
// finds nothing carried, and leaves the text to the editor.
//
// Expectation rewritten 2026-10-05 (Jason's Q1: a carried definition that
// sat in a quote or a list item lands unwrapped, in the clipboard text
// too). The pin first expected the quote markers kept, "> [^1]: quoted";
// the copy now carries "[^1]: quoted", and the round trip and the phone
// route are checked on that.

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

describe("a carried quoted definition, read back from the clipboard text", () => {
    it("d: splitCarriedText hands back the quoted definition that withCarriedText wrote", () => {
        const source = "a[^1] b\n\n> [^1]: quoted";
        const { carried } = carriedDefinitions(source, { line: 0, ch: 0 }, { line: 0, ch: 7 });
        expect(carried).toEqual([{ name: "1", lines: ["[^1]: quoted"] }]);
        const text = withCarriedText("a[^1] b", carried);
        // Today the split finds nothing: the whole text comes back as the
        // body and the carried list is empty.
        expect(splitCarriedText(text)).toEqual({ body: "a[^1] b", carried });
    });

    // The phone route: a keyboard's clipboard history commits the text
    // through the input method (the system that turns key presses into
    // text) instead of firing a paste event, so carriedInputHandler sees
    // it and returns whether it took the text over.
    it("3a: a copy whose definition sat in a blockquote lands as a paste would, not as plain text", () => {
        const source = editor(["a[^1] b", "", "> [^1]: quoted"], { line: 0, ch: 0 }, { line: 0, ch: 7 });
        const copy = clipboardEvent();
        handleCopy(fakePlugin(on, source), copy as never);
        const text = copy.written["text/plain"];
        expect(text).toBe("a[^1] b\n\n[^1]: quoted");
        const doc = editor(["p"], { line: 0, ch: 1 });
        const handle = carriedInputHandler(fakePlugin(on, doc), () => doc);
        const at = doc.posToOffset({ line: 0, ch: 1 });
        expect(handle({} as never, at, at, text)).toBe(true);
    });
});
