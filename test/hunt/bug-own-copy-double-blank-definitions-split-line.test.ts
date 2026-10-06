import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a copied selection that ends in its own definitions,
// spaced by two blank lines, splits the line it is pasted into.
//
// What the user would see: the user's note spaces its definitions with
// two blank lines ("[^1]: one", two blank lines, "[^2]: two"). They select
// from "See[^1] and[^2]." down to the end of "[^2]: two" (no line break
// at the end of the selection) and copy. Pasted into the middle of "dest
// abc def", after "abc", the text should sit inside the line: "dest
// abcSee[^1] and[^2]. def". Instead " def" is pushed onto a line of its
// own, as if the selection had ended in a line break.
//
// Hunt 2026-10-06, cycle 4, lens carry. Cluster K2.
//
// Origin: regression (since ea38e82, from d77449d).
//
// Source of truth: the selection itself, which holds no line break after
// "two", and the README's Paste paragraph (the text lands at the caret,
// and the definitions go where a new footnote would).
//
// Cause: splitCarriedText in src/commands/carry-footnotes.ts reads every
// blank line past the first between two trailing definitions as the
// selection's own closing line break and puts it back on the end of the
// body. The plugin's own copy goes through the same split (remember() in
// src/commands/carry-footnotes-hooks.ts), so a note that simply spaces
// its definitions by two blank lines gets a body ending in a line break
// it never had.

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
type Pos = { line: number; ch: number };

/**
 * Copies from..to out of a note holding `lines` and returns the clipboard
 * text: what the plugin wrote, or, when the plugin leaves the copy to the
 * editor, the selected text as the editor copies it.
 */
function copy(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCopy(fakePlugin(settings, doc), event as never);
    if ("text/plain" in event.written) return event.written["text/plain"];
    const picked = lines.slice(from.line, to.line + 1);
    picked[picked.length - 1] = picked[picked.length - 1].slice(0, to.ch);
    picked[0] = picked[0].slice(from.ch);
    return picked.join("\n");
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

describe("bug: the plugin's own copy of a selection ending in definitions spaced by two blank lines", () => {
    it.fails("pasted mid-line, it keeps the line whole", () => {
        const note = ["See[^1] and[^2].", "", "[^1]: one", "", "", "[^2]: two", "", "dest abc def"];
        // the selection ends right after "two", with no line break
        const clip = copy(note, { line: 0, ch: 0 }, { line: 5, ch: 9 });
        const back = paste(["dest abc def"], { line: 0, ch: 8 }, clip);
        // Today the note reads "dest abcSee[^1] and[^2].", " def", "",
        // "[^1]: one", "[^2]: two".
        expect(back.lines[0]).toBe("dest abcSee[^1] and[^2]. def");
    });
});
