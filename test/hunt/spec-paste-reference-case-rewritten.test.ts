import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: should a paste rewrite a carried reference to the case
// of its definition's label when nothing needs renaming?
//
// What it does now: the user's text reads "See[^Note] here." and the
// definition is labelled "[^note]:". They copy the sentence and paste it
// into a note with no footnote of that name. Nothing collides and
// nothing is renamed, yet the pasted text reads "See[^note] here.": the
// user's own reference changed case.
// What a user might expect: the pasted text reads exactly as they copied
// it, "See[^Note] here.".
// Why it is a question and not a bug: names ignore case, so [^Note] and
// [^note] are the same footnote either way and the footnote still works.
// The only question is whether a paste should touch a reference it does
// not need to rename. Severity if ruled a bug: annoyance.
//
// Hunt 2026-10-02, round 3, lens carry-model. Cluster M4.
//
// Source of truth: CONTEXT.md and the README's Rename paragraph, "Names
// are case-insensitive, so [^Note] and [^note] count as the same
// footnote", and a paste inserts the copied text as it was.

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

/** A paste in the same window as the copy, so the plugin recognises its own last copy. */
function pasteRegister(lines: string[], at: Pos, text: string): string[] {
    const doc = ed(lines, at);
    const e = clip(text);
    if (!handlePaste(on(doc), e as never, doc)) throw new Error("paste not taken over");
    return doc.lines;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a pasted reference keeps its own case", () => {
    it.fails("[^Note] stays [^Note] when its definition is labelled [^note] and the destination has no such name", () => {
        const text = copy(["See[^Note] here.", "", "[^note]: the text"], { line: 0, ch: 0 }, { line: 0, ch: 16 });
        const lines = pasteRegister(["Other."], { line: 0, ch: 6 }, text);
        // Today: "Other.See[^note] here."
        expect(lines[0]).toBe("Other.See[^Note] here.");
    });
});
