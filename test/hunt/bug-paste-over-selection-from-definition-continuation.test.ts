import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): copying a selection that starts on a footnote's
// second line and runs through the paragraph citing it, then pasting it
// straight back over the same selection, changes the note.
//
// What the user would see: the note holds "[^x]: charlie" with its text
// running on to an indented second line, "    continued alpha", and then
// a paragraph "See[^x].". The user selects from the start of that second
// line down to the start of the line after "See[^x].", copies, and pastes
// over the same selection, which should change nothing. Instead:
// - from the start of the indented line, a blank line appears between
//   "[^x]: charlie" and "    continued alpha", so the footnote's text
//   splits into two paragraphs;
// - from inside the indentation (column 2), the footnote is cut short at
//   "charlie", a copy "[^x-2]: charlie" with the full text is added, the
//   reference is repointed to [^x-2], and the second line is left twice
//   in the note;
// - from the start of a lazy second line ("lazy more", not indented, still
//   part of the footnote's paragraph), the same "[^x-2]" copy is added and
//   the reference repointed.
//
// Hunt 2026-10-06, cycle 4, lens round trip. Cluster RT1.
//
// Origin: pre-existing.
//
// Source of truth: a paste of exactly the text that was selected, over
// that selection, is a no-op; Obsidian reads "[^b]: Definition", "",
// "    continued" as one definition (test/obsidian-answers/
// fuzz-20261003.json), so the blank line is a real change in what the
// footnote holds.
//
// Cause: asOwnParagraph in src/commands/carry-footnotes-hooks.ts judges
// "is the paste made inside a definition" on the note with the selection
// already cleared. There the caret's line is empty or holds only the
// indentation, so the paste counts as made outside the footnote, and the
// text gets a blank line in front of it. The question belongs to the note
// before the selection is cleared, where the caret sits in the footnote's
// own text.

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

/** Copies from..to out of a note holding `lines`; returns the clipboard text and whether the plugin took the copy over. */
function copy(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCopy(fakePlugin(settings, doc), event as never);
    return { clip: event.written["text/plain"], taken: event.defaultPrevented };
}

/** Pastes `clip` into a note holding `lines` over the selection from..to; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], from: Pos, clip: string, to: Pos = from) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(settings, doc), event as never, doc);
    return { lines: doc.lines.slice(), taken: event.defaultPrevented };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("bug: copy, then paste over the same selection, from a footnote's second line through the paragraph citing it", () => {
    // a footnote whose text runs onto an indented second line, then a paragraph citing it
    const note = ["Intro.", "", "[^x]: charlie", "    continued alpha", "", "See[^x].", "", "End."];
    const to = { line: 6, ch: 0 };

    it("from the start of the indented second line: the note is left as it was, the footnote one paragraph", () => {
        const from = { line: 3, ch: 0 };
        const c = copy(note, from, to);
        expect(c.taken).toBe(true);
        const back = paste(note, from, c.clip, to);
        // Today a blank line lands between "[^x]: charlie" and "    continued alpha".
        const x = readNote(back.lines).definitions.find((d) => d.name === "x");
        expect(x && back.lines.slice(x.start, x.end + 1).some((l) => l.trim() === "")).toBe(false);
        expect(back.lines).toEqual(note);
    });

    it("from inside the indentation of the second line: the note is left as it was", () => {
        const from = { line: 3, ch: 2 };
        const c = copy(note, from, to);
        expect(c.taken).toBe(true);
        const back = paste(note, from, c.clip, to);
        // Today the note gains "[^x-2]: charlie" and a second "  continued
        // alpha", and the paragraph reads "See[^x-2].".
        expect(back.lines).toEqual(note);
    });

    it("from the start of a lazy second line: the note is left as it was", () => {
        const lazy = ["Intro.", "", "[^x]: charlie", "lazy more", "", "See[^x].", "", "End."];
        const c = copy(lazy, { line: 3, ch: 0 }, to);
        const back = paste(lazy, { line: 3, ch: 0 }, c.clip, to);
        // Today the note gains "[^x-2]: charlie", a second "lazy more", and
        // the paragraph reads "See[^x-2].".
        expect(back.lines).toEqual(lazy);
    });
});
