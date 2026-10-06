import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carriedInputHandler, carryRegister, handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a line-wise selection that ends with its own
// definition and cites a footnote defined outside it loses its last line
// break when pasted from another app or a phone keyboard.
//
// What the user would see: the user selects whole lines (Shift+Down, so
// the selection ends at the start of the next line) holding a paragraph,
// a blank line, and the definition of one of its footnotes, while another
// footnote in the paragraph is defined further down. They copy it and
// paste it at the start of a line in another window, another vault, or
// from the phone keyboard's clipboard history. The pasted paragraph is
// glued onto the line that was after the caret ("a[^1] b[^2]Next."),
// where a paste of the plugin's own copy in the same window keeps
// "Next." on its own line.
//
// Hunt 2026-10-06, cycle 3, lens carry. Cluster K3.
//
// Origin: pre-existing.
//
// Source of truth: the attack-surface carry checklist ("The three paste
// routes" give the same note for the same clipboard text) and Jason's
// ruling of 2026-10-06 (00cb07e: the plugin's own copy is pasted the way
// the same clipboard text from another app is). The register route,
// which pastes the plugin's own copy, keeps the line break.
//
// Cause: the clipboard text is the selection, "a[^1] b[^2]", a blank
// line, "[^1]: one" and the selection's closing line break, then a blank
// line and the carried "[^2]: two". splitCarriedText in
// src/commands/carry-footnotes.ts takes both definitions as one trailing
// run and puts back only the line breaks after the last one. The
// selection's own line break sits between the two definitions, so it is
// dropped, and the body has no line break at its end.

type Pos = { line: number; ch: number };

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clip(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (t: string) => (t === "text/plain" ? text : ""),
            setData: (t: string, v: string) => {
                event.written[t] = v;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

/** A fake editor holding `lines`, with the selection running from `from` to `to` (the same place when nothing is selected). */
function ed(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}
const settings = { carryFootnotesOnCopy: true };

/**
 * Copies from `source` (selection from..to), then pastes into `dest` at
 * `at` by each of the three routes: the register route (the plugin
 * remembers its own copy), the foreign route (the same text as if it came
 * from another app, register cleared), and the input-method route (a phone
 * keyboard's clipboard history). Returns the three notes.
 */
function threeRoutes(source: string[], from: Pos, to: Pos, dest: string[], at: Pos, cut = false) {
    resetCarryRegister();
    const src = ed(source, from, to);
    const ev = clip();
    if (cut) handleCut(fakePlugin(settings, src), ev as never);
    else handleCopy(fakePlugin(settings, src), ev as never);
    const text = ev.written["text/plain"];
    expect(text, "the copy carried something").toBeDefined();
    // register route
    const d1 = ed(dest, at);
    handlePaste(fakePlugin(settings, d1), clip(text) as never, d1);
    const reg = carryRegister();
    // foreign route
    resetCarryRegister();
    const d2 = ed(dest, at);
    handlePaste(fakePlugin(settings, d2), clip(text) as never, d2);
    // input-method route
    const d3 = ed(dest, at);
    const handle = carriedInputHandler(fakePlugin(settings, d3), () => d3);
    const off = d3.posToOffset(at);
    handle({} as never, off, off, text);
    return { text, reg, register: d1.lines.join("\n"), foreign: d2.lines.join("\n"), ime: d3.lines.join("\n") };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("bug: a line-wise selection's line break before a carried outside definition", () => {
    it.fails("the line-wise selection keeps its line break on the foreign route (the text after the caret stays on its own line)", () => {
        // lines 0 to 2 selected line-wise (Shift+Down to the start of line 3)
        const source = ["a[^1] b[^2]", "", "[^1]: one", "", "[^2]: two"];
        const r = threeRoutes(source, { line: 0, ch: 0 }, { line: 3, ch: 0 }, ["Intro.", "Next."], { line: 1, ch: 0 });
        // The pasted body ended with a line break, so "Next." starts its own
        // line. Today the foreign route gives "a[^1] b[^2]Next.".
        expect(r.foreign.split("\n")).toContain("Next.");
    });
});
