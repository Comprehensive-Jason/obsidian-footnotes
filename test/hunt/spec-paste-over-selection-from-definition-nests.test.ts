import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: when a DIFFERENT text is pasted over a selection that
// starts on a footnote's second line and runs into the next paragraph,
// should the pasted text land as a paragraph of its own, or as more of
// that footnote's text?
//
// What it does now: the note reads "Text[^1].", "[^1]: one" with
// "    two" as its indented second line, then "Para.". The user selects
// from the start of "    two" through the end of "Para." and pastes
// "New[^2].", a blank line, and "[^2]: fresh", copied from somewhere
// else. The paste lands "New[^2]." right under "[^1]: one", where
// Obsidian reads it as more of [^1]'s text: the footnote's "two" is
// replaced by the pasted paragraph, and the pasted reference sits inside
// a footnote (a nested footnote). A line-wise selection and a line-wise
// text do the same.
// What a user might expect: the selected text is gone and the pasted
// paragraph stands on its own, after a blank line, so [^1] reads "one"
// and [^2] is cited from the text.
// Why it is a question and not a bug: fc50f85 decided on purpose that a
// paste over a selection starting inside a definition is made inside that
// definition, which is right for a paste back of the same text (cut a
// footnote's second line and the paragraph after it, then paste them
// back: the second line must rejoin the footnote). The plugin cannot tell
// that paste back from a paste of different text by where it lands.
// Whether a text that is not the definition's own continuation should be
// put in a paragraph of its own is Jason's call.
//
// Hunt 2026-10-06, cycle 5, lens carry. Cluster X15.
//
// Origin: the character-wise face changed on purpose with fc50f85; the
// line-wise face is older.
//
// Source of truth: ADR 0001 (no nested footnotes), asOwnParagraph's
// docstring in src/commands/carry-footnotes-hooks.ts, and fc50f85 (pin
// bug-paste-over-selection-from-definition-continuation).

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

/** Pastes `clip` over the selection `at`..`to` in a note holding `lines`; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], at: Pos, clip: string, to: Pos = at) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: to } });
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(settings, doc), event as never, doc);
    return { lines: doc.lines.slice(), taken: event.defaultPrevented };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a different text pasted over a selection from a definition's second line", () => {
    it.fails("a paste over a selection from a definition's second line through the next paragraph does not nest the pasted footnote (character-wise)", () => {
        const note = ["Text[^1].", "", "[^1]: one", "    two", "", "Para."];
        const back = paste(note, { line: 3, ch: 0 }, ["New[^2].", "", "[^2]: fresh"].join("\n"), { line: 5, ch: 5 });
        expect(back.taken).toBe(true);
        // "New[^2]." must not sit right under "[^1]: one" as its lazy continuation
        const i = back.lines.indexOf("New[^2].");
        expect(i).toBeGreaterThan(0);
        // Today the line above it is "[^1]: one".
        expect(back.lines[i - 1]).toBe("");
    });

    it.fails("the same with a line-wise selection and a line-wise text", () => {
        const note = ["Text[^1].", "", "[^1]: one", "    two", "", "Para.", "End."];
        const back = paste(note, { line: 3, ch: 0 }, ["New[^2].", "", "", "[^2]: fresh"].join("\n"), { line: 6, ch: 0 });
        expect(back.taken).toBe(true);
        const i = back.lines.indexOf("New[^2].");
        expect(i).toBeGreaterThan(0);
        expect(back.lines[i - 1]).toBe("");
    });
});
