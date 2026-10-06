import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a carried paste with the caret at the start of a
// definition's label line puts the pasted paragraph right above the
// label, so that definition stops being one.
//
// What the user would see: the caret sits at the very start of a line
// such as "[^2]: beta", with a blank line above it. This happens on its
// own after a cut that takes another definition out: the blank lines
// close up and the caret comes to rest there. The user pastes text that
// carries a footnote. The pasted paragraph lands directly above
// "[^2]: beta" with no blank line between them, so Obsidian reads the
// label as more of the paragraph (a lazy label: a label line that
// carries on the paragraph above, so it defines nothing). [^2] loses its
// definition, and "uses[^2]" shows a dead reference.
//
// Hunt 2026-10-06, cycle 3, lens mix (interactions). Cluster M5.
//
// Origin: pre-existing.
//
// Source of truth: asOwnParagraph's docstring in
// src/commands/carry-footnotes-hooks.ts ("a definition label right under
// the pasted text would read as more of its paragraph (a lazy label), and
// that footnote would lose its definition. The text then gets a blank
// line after it too"), and ADR 0002 (never eat text).
//
// Cause: asOwnParagraph looks for a label on the line below the caret's
// line. With the caret at column 0 of a label line, the label is on the
// caret's own line, after the caret, so the check misses it, and the
// pasted text, which ends in a line break, pushes the label right under
// its last line with no blank line between.

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

describe("bug: a carried paste at the start of a label line makes the label lazy", () => {
    it.fails("a paste at column 0 of a definition's label line leaves that definition a definition", () => {
        const note = ["Intro.", "", "[^2]: beta", "", "uses[^2]"];
        const back = paste(note, { line: 2, ch: 0 }, "x[^1] y\n\n\n[^1]: one");
        const i = back.lines.indexOf("[^2]: beta");
        expect(i).toBeGreaterThan(0);
        // Today the line above "[^2]: beta" is the pasted "x[^1] y".
        expect(back.lines[i - 1].trim()).toBe("");
    });

    it.fails("cut then paste back at the caret leaves [^2]'s definition a definition", () => {
        // The selection: the blank line under [^1]'s definition and the
        // line citing it, through its line break. The cut takes [^1]'s
        // definition and a blank line out, and the caret comes to rest at
        // the start of "[^2]: beta".
        const note = ["Intro.", "", "[^1]: alpha", "    continued alpha", "", "[^1] alpha", "", "[^2]: beta", "", "uses[^2]"];
        const after = cut(note, { line: 4, ch: 0 }, { line: 6, ch: 0 });
        const back = paste(after.lines, after.caret, after.clip);
        const i = back.lines.indexOf("[^2]: beta");
        expect(i).toBeGreaterThan(0);
        // Today the line above "[^2]: beta" is the pasted "[^1] alpha".
        expect(back.lines[i - 1].trim()).toBe("");
    });
});
