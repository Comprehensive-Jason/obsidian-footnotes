import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (annoyance): text from another app that cites [^1], pasted inside a
// code block, inline code, or a math block, gets a notice that [^1] has
// no definition, though there it is no footnote at all.
//
// What the user would see: the user pastes "Here is a footnote[^1]."
// between the two fences of a code block (or "x[^1]" between two
// backticks, or "a^[1] x[^1]" inside a "$$" math block). The editor
// pastes it as usual, which is right: inside protected text (code and
// math, which Obsidian shows as written) "[^1]" is plain characters, not
// a reference. Yet a notice pops up for 8 seconds: '"[^1]" has no
// definition to carry.'
//
// Hunt 2026-10-06, cycle 5, lens carry. Cluster X11.
//
// Origin: regression (since 5379d63, which added the notice for a text
// the plugin did not copy).
//
// Source of truth: the note reading (a "[^1]" inside code or math is no
// reference), and the README's Paste paragraph: the toast names a
// reference that travelled without a definition; here nothing travelled
// as a reference.
//
// Cause: landPastedText in src/commands/carry-footnotes-hooks.ts shows
// the notice whenever nothing landed and the text, read on its own (by
// uncarriedNames), cites a name it does not define. It never asks where
// the text lands, so it speaks up inside protected text too.

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

/** Pastes `clip` at `at` in a note holding `lines`; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], at: Pos, clip: string) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(settings, doc), event as never, doc);
    return { lines: doc.lines.slice(), taken: event.defaultPrevented };
}

/** The notices that speak of a missing definition. */
const noDefinitionNotices = () => messages().filter((m) => m.includes("no definition"));

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("no missing-definition notice for a paste into protected text", () => {
    it("a foreign text citing [^1] pasted inside a fenced code block says nothing about a missing definition", () => {
        const note = ["Intro.", "", "```", "", "```"];
        const back = paste(note, { line: 3, ch: 0 }, "Here is a footnote[^1].");
        expect(back.taken).toBe(false);
        // Today: ['"[^1]" has no definition to carry.']
        expect(noDefinitionNotices()).toEqual([]);
    });

    it("a foreign text citing [^1] pasted inside inline code says nothing about a missing definition", () => {
        const note = ["Write `` here."];
        const back = paste(note, { line: 0, ch: 7 }, "x[^1]");
        expect(back.taken).toBe(false);
        expect(noDefinitionNotices()).toEqual([]);
    });

    it("a foreign text citing [^1] pasted inside a math block says nothing about a missing definition", () => {
        const note = ["$$", "", "$$"];
        paste(note, { line: 1, ch: 0 }, "a^[1] x[^1]");
        expect(noDefinitionNotices()).toEqual([]);
    });
});
