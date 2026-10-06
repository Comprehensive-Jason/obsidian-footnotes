import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { carriedInputHandler, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (annoyance): a text that carries no definition and cites a footnote
// gets a notice when pasted, but none when it arrives through a phone
// keyboard's clipboard history.
//
// What the user would see: the clipboard reads "see [^9]" and "more" on
// two lines, with no definition for [^9]. Pasted on a computer, the
// editor pastes it as usual and a notice says '"[^9]" has no definition
// to carry.'. Committed from the clipboard history of Gboard or Samsung
// Keyboard on a phone, the same text lands with no notice at all.
//
// Hunt 2026-10-06, cycle 5, lens carry. Cluster X9.
//
// Origin: regression in the strict sense (since 5379d63, which added the
// notice on the paste event route only).
//
// Source of truth: 5379d63's own rule that both routes for a text the
// plugin did not copy, the paste event and the phone's input route, give
// the same word; and the README's Paste paragraph, which names any
// reference that travelled without a definition.
//
// Cause: landPastedText in src/commands/carry-footnotes-hooks.ts shows
// the notice when nothing landed and the text cites a name it does not
// define. carriedInputHandler, the phone's input route, returns false as
// soon as the text carries no definition, before any such notice.

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
const settings = { carryFootnotesOnCopy: true, enableRemoveBlankLastLines: true, enableFootnoteSectionHeading: false, footnoteSectionHeading: "# Footnotes", removeEmptySectionHeading: false, lintOnFootnoteCreation: false };

/** A line and a character in it. */
type Pos = { line: number; ch: number };

/** A fake editor holding `lines` with a bare caret at `at`. */
const editor = (lines: string[], at: Pos) => fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });

/** Pastes `clip` at `at` in a note holding `lines` (the paste event route). */
function paste(lines: string[], at: Pos, clip: string): void {
    const doc = editor(lines, at);
    handlePaste(fakePlugin(settings, doc), clipboardEvent(clip) as never, doc);
}

/** The phone keyboard's clipboard history committing `text` at `at` (the input handler route). */
function commit(lines: string[], at: Pos, text: string): void {
    const doc = editor(lines, at);
    const handler = carriedInputHandler(fakePlugin(settings, doc), () => doc);
    const offset = doc.posToOffset(at);
    handler({} as never, offset, offset, text);
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("the notice for a text that carries nothing, on both routes", () => {
    it("the paste event route and the phone input route give the same word for a text that carries nothing and cites [^9]", () => {
        const clip = "see [^9]\nmore";
        paste(["Dest.", ""], { line: 1, ch: 0 }, clip);
        const eventToasts = messages().slice();
        // the paste event route names [^9]
        expect(eventToasts.join("\n")).toContain("[^9]");
        resetNotices();
        commit(["Dest.", ""], { line: 1, ch: 0 }, clip);
        // Today the input route shows nothing.
        expect(messages()).toEqual(eventToasts);
    });
});
