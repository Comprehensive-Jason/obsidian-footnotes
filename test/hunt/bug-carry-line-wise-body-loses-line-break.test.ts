import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carriedInputHandler, handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a paragraph copied or cut line-wise loses its line
// break on the way back in, so it glues onto the text at the paste point.
//
// What the user would see: they select a paragraph with Shift+Down, so the
// selection ends at the very start of the next line and holds the
// paragraph's line break. On a phone they cut it and paste it straight
// back from the keyboard's clipboard history: the note now reads
// "Intro[^1] text.Next para.", two paragraphs run together. The same
// happens when the clipboard reaches another vault's window (or any
// paste the plugin does not recognise as its own last copy). A paste in
// the same window keeps the line break, so the same clipboard lands
// differently depending on the route.
//
// Hunt 2026-10-02, round 3, lens carry-model. Cluster M1.
//
// Source of truth: a paste inserts the copied text as it was (CodeMirror's
// own paste does). splitCarriedText's docstring calls it "the mirror of
// withCarriedText", so splitting the clipboard text must give back the
// body that was copied.
//
// Cause: withCarriedText trims the body's trailing line breaks before it
// adds the blank line and the definitions, and splitCarriedText cannot
// tell they were ever there. The paste in the same window reads the body
// from the plugin's memory of the last copy (register.body), which still
// has them; every other route reads the clipboard text.

/** A line and a character in it. */
type Pos = { line: number; ch: number };

/** A stand-in for the browser's clipboard event: it reads `text`, and records what the hook writes and whether the hook took the event over. */
function clip(text = "") {
    const e = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (t: string) => (t === "text/plain" ? text : ""),
            setData: (t: string, v: string) => {
                e.written[t] = v;
            },
        },
        preventDefault() {
            e.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return e;
}

/** A fake editor holding `lines`, with the selection running from `from` to `to` (a bare caret when `to` is left out). */
function ed(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

/** A plugin for `doc` with carrying on and every other setting at its default. */
const on = (doc: ReturnType<typeof ed>) => fakePlugin({ carryFootnotesOnCopy: true }, doc);

/** The clipboard text a copy of `from` to `to` in `lines` writes. */
function copy(lines: string[], from: Pos, to: Pos): string {
    const doc = ed(lines, from, to);
    const e = clip();
    handleCopy(on(doc), e as never);
    return e.written["text/plain"] ?? "";
}

/** A paste whose clipboard did not come from this window's last copy (another vault's window, another app). */
function pasteForeign(lines: string[], at: Pos, text: string): string[] {
    resetCarryRegister();
    const doc = ed(lines, at);
    const e = clip(text);
    if (!handlePaste(on(doc), e as never, doc)) throw new Error("paste not taken over");
    return doc.lines;
}

/** The phone keyboard's clipboard history: the text arrives through the input method, with no paste event. */
function pasteThroughKeyboard(lines: string[], at: Pos, text: string): string[] {
    const doc = ed(lines, at);
    const offset = doc.posToOffset(at);
    if (!carriedInputHandler(on(doc), () => doc)({} as never, offset, offset, text)) throw new Error("insert not taken over");
    return doc.lines;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a line-wise selection keeps its trailing line break through the clipboard text", () => {
    it("phone: cut a paragraph line-wise and paste it back where it was, the note reads as before", () => {
        const note = ["Intro[^1] text.", "", "Next para.", "", "[^1]: one"];
        const doc = ed(note, { line: 0, ch: 0 }, { line: 2, ch: 0 });
        const e = clip();
        handleCut(on(doc), e as never);
        expect(e.defaultPrevented).toBe(true);
        const back = pasteThroughKeyboard(doc.lines, { line: 0, ch: 0 }, e.written["text/plain"]);
        // Today: the first line reads "Intro[^1] text.Next para."
        expect(back.slice(0, 3)).toEqual(["Intro[^1] text.", "", "Next para."]);
    });

    it("another window's clipboard: a paragraph copied line-wise and pasted at the start of another stays its own paragraph", () => {
        const source = ["First[^1] paragraph.", "", "Second paragraph.", "", "[^1]: one"];
        const destination = ["Other note.", "", "Last para."];
        const text = copy(source, { line: 0, ch: 0 }, { line: 2, ch: 0 });
        const lines = pasteForeign(destination, { line: 2, ch: 0 }, text);
        // Today: the pasted paragraph and "Last para." share one line
        expect(lines).toContain("First[^1] paragraph.");
        expect(lines).toContain("Last para.");
    });
});
