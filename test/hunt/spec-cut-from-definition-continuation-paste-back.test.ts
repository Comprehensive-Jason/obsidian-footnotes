import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: a cut that starts on a footnote's lazy second line and
// runs through the paragraph citing it, pasted straight back: should the
// paste go back into the footnote it came out of?
//
// What it does now: the note holds "[^x]: charlie" with a lazy second
// line "lazy more" (not indented, still part of the footnote's paragraph),
// then "See[^x].". The user selects from the start of "lazy more" down to
// the start of the line after "See[^x]." and cuts: the note keeps
// "[^x]: charlie", and the clipboard carries the footnote's whole text.
// Pasted back at the caret (the line right under "[^x]: charlie"), the
// text is kept out of the footnote, so the carried "[^x]: charlie / lazy
// more" no longer matches the note's "[^x]: charlie" and is added as
// "[^x-2]", with "See[^x-2]." pointing at it and "lazy more" in the note
// twice.
// What a user might expect: the note comes back exactly as it was, since
// the text came out of that very footnote.
// Why it is a question and not a bug: the paste is made outside any
// definition once the selection is gone, and a paste made there that
// would be read as part of the definition above gets a blank line in
// front (asOwnParagraph, ADR 0001: no nested footnotes). That guard does
// its documented job here. Whether the paste back should be judged on the
// note as it read before the cut (where the caret sat inside the
// footnote) is a design choice. (The copy-and-paste-over face of the same
// selection is a bug, pinned in
// bug-paste-over-selection-from-definition-continuation.)
//
// Hunt 2026-10-06, cycle 4, lens round trip. Cluster RT2.
//
// Origin: pre-existing.
//
// Source of truth: the README's Cut and Paste paragraphs (a definition
// the cut leaves in the note "travels as a copy", and a definition the
// destination already has, same text, is reused); asOwnParagraph's own
// comment in src/commands/carry-footnotes-hooks.ts.

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
type Pos = { line: number; ch: number };

/** Cuts from..to out of a note holding `lines`; returns the note, the clipboard text, and the caret after the cut. */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(fakePlugin(settings, doc), event as never);
    return { lines: doc.lines.slice(), clip: event.written["text/plain"], caret: doc.cursor };
}

/** Pastes `clip` into a note holding `lines` with the caret at `at`; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], at: Pos, clip: string) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(settings, doc), event as never, doc);
    return { lines: doc.lines.slice(), taken: event.defaultPrevented };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: cut from a footnote's lazy second line through the paragraph citing it, then paste back", () => {
    it.fails("the paste back gives the note back", () => {
        const lazy = ["Intro.", "", "[^x]: charlie", "lazy more", "", "See[^x].", "", "End."];
        const c = cut(lazy, { line: 3, ch: 0 }, { line: 6, ch: 0 });
        const back = paste(c.lines, c.caret, c.clip);
        // Today the note reads "[^x]: charlie", "[^x-2]: charlie", "lazy
        // more", "", "lazy more", "", "See[^x-2].", "", "End.".
        expect(back.lines).toEqual(lazy);
    });
});
