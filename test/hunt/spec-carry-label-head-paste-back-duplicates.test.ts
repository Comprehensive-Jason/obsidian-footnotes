import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: when a cut ends one character into a definition's label
// (or starts inside one), should a paste straight back reuse the
// definition it repairs, rather than add a second copy?
//
// What it does now: the note is a table whose last row cites [^109], with
// "[^109]: under table" right under the table. Selecting the whole table
// and the "[" of the label, then cutting, leaves "^109]: under table":
// the label is broken, so the cut cannot take the definition out whole,
// keeps the rest of its line, and carries a copy on the clipboard.
// Pasting straight back at the caret puts the "[" back, which repairs
// the label, and also appends the carried copy: the note ends with
// "[^109]: under table" twice.
// What a user might expect: a cut and a paste back at the same place
// gives the note back, with one definition.
// Why it is a question and not a bug: the selection cuts through a label,
// so neither the cut nor the paste can keep the definition whole on its
// own, and no promise covers a selection that ends inside a label. The
// paste could plan against the note as it reads once the pasted text has
// landed (where the label is whole again and its text matches), or the
// cut could refuse to carry a definition whose label it cuts through.
// Which way to go is Jason's call.
//
// Hunt 2026-10-06, cycle 3, lens mix (interactions). Cluster M4.
//
// Origin: pre-existing.
//
// Source of truth: the README's Cut and Paste paragraphs (a definition
// left in the note "travels as a copy"; a definition the destination
// already has, same text, is reused), and planCut's docstring in
// src/commands/carry-footnotes.ts.

interface FakeClipboardEvent {
    clipboardData: { getData(type: string): string; setData(type: string, value: string): void; types: string[] };
    preventDefault(): void;
    stopPropagation(): void;
    defaultPrevented: boolean;
    written: Record<string, string>;
}

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clipboardEvent(text = ""): FakeClipboardEvent {
    const event: FakeClipboardEvent = {
        written: {},
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
const settings = { carryFootnotesOnCopy: true, enableFootnoteSectionHeading: false, footnoteSectionHeading: "# Footnotes", removeEmptySectionHeading: false, lintOnFootnoteCreation: false };

/** Cuts from..to out of a note holding `lines`; returns the note, the clipboard text, whether the plugin took the cut over, and the caret after the cut. */
function cut(lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(fakePlugin(settings, doc), event as never);
    return { lines: doc.lines.slice(), clip: event.written["text/plain"], taken: event.defaultPrevented, caret: doc.cursor };
}

/** Pastes `clip` into a note holding `lines` with the caret at `at`; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], at: { line: number; ch: number }, clip: string) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(settings, doc), event as never, doc);
    return { lines: doc.lines.slice(), taken: event.defaultPrevented };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a cut ending one character into a label, pasted back", () => {
    // the selection: a whole table and the "[" of the label under it, so
    // the definition is carried (the selection does not hold its whole
    // label) but its line cannot leave the note whole
    const note = ["| a | b |", "| --- | --- |", "| c[^109] | d |", "[^109]: under table"];
    const from = { line: 0, ch: 0 };
    const to = { line: 3, ch: 1 };

    it.fails("cut then paste back at the caret gives the note back, with one definition", () => {
        const after = cut(note, from, to);
        const back = paste(after.lines, after.caret, after.clip);
        // Today the note ends with "[^109]: under table" twice.
        expect(back.lines.filter((line) => line.startsWith("[^109]:")).length).toBe(1);
    });
});
