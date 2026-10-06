import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a cut through a line break that leaves its carried
// definition right under the remaining text keeps the definition as
// plain text and also carries it, so a paste back gives two copies.
//
// What the user would see: the note reads "Body text with a note[^1].",
// a blank line, and "[^1]: alpha". The user selects from the second
// character of the first line through its line break (into the blank
// line) and cuts. The note is left as "B" with "[^1]: alpha" right under
// it, where Obsidian reads it as more of the paragraph "B" (a lazy label:
// a label line that carries on the paragraph above, so it defines
// nothing). Pasting straight back at the caret renames the pasted
// footnote to [^2] and adds "[^2]: alpha", while "[^1]: alpha" turns
// back into a definition that nothing references: the same text twice.
//
// Hunt 2026-10-06, cycle 3, lens mix (interactions). Cluster M3.
//
// Origin: pre-existing.
//
// Source of truth: planCut's promise in src/commands/carry-footnotes.ts
// and the README's Cut paragraph: a cut removes the selection plus the
// definitions it carries that nothing else in the note uses. The same cut
// starting at column 0 takes the definition out.
//
// Cause: planCut only takes out a block the orphan rule's reader finds
// as an orphaned definition in the note once the selection is deleted.
// There "[^1]: alpha" sits right under "B" and reads as paragraph text,
// not as a definition, so it is never a candidate and stays, while the
// clipboard still carries it.

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

describe("bug: a cut that leaves its carried definition as a lazy label", () => {
    const note = ["Body text with a note[^1].", "", "[^1]: alpha"];
    // the selection: "ody text with a note[^1]." plus the line break after it
    const from = { line: 0, ch: 1 };
    const to = { line: 1, ch: 0 };

    it("the cut takes the definition it carries out of the note (nothing else uses it)", () => {
        const after = cut(note, from, to);
        // Today the note reads "B", "[^1]: alpha".
        expect(after.lines).toEqual(["B"]);
    });

    it("cut then paste back at the caret gives the note back, with one definition", () => {
        const after = cut(note, from, to);
        const back = paste(after.lines, after.caret, after.clip);
        // Today the note reads "Body text with a note[^2].", "", "[^1]: alpha", "[^2]: alpha".
        expect(back.lines.join("\n")).not.toContain("[^2]");
        expect(back.lines.filter((line) => line.endsWith(": alpha")).length).toBe(1);
    });
});
