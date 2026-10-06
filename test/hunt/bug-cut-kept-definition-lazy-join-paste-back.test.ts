import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a cut that keeps its carried definition and hands
// it a lazy continuation does not paste back as it was; the paste adds a
// renamed copy of the definition.
//
// What the user would see: the note reads "[^1]: one", a blank line, and
// "alpha[^1]. more". The user selects from the blank line through
// "alpha[^1]" and cuts. The cut keeps "[^1]: one" in the note and joins
// ". more" right under it, where it reads as more of the definition's
// text (a lazy continuation: a line that carries on the paragraph above
// it without being indented). Pasting straight back at the caret does
// not give the note back: the pasted reference becomes [^2], a second
// definition "[^2]: one" is added, and "[^1]: one" is left with nothing
// referencing it.
//
// Hunt 2026-10-06, cycle 3, lens mix (interactions). Cluster M2.
//
// Origin: regression (since cec4352, from 3145b1e and 60c4955: the cut
// now keeps a definition when taking it out would change how the lines
// around it read).
//
// Source of truth: the README's Cut and Paste paragraphs (a definition
// that stays in the note "travels as a copy", and a definition the
// destination already has, same text, is reused), and planCut's own
// comment in src/commands/carry-footnotes.ts ("pasting the text back
// reuses it", Jason's triage decision Q2, 2026-10-05).
//
// Cause: landCarriedText in src/commands/carry-footnotes-hooks.ts plans
// the paste against the note before the pasted body lands. There ". more"
// is still the definition's lazy continuation, so the definition reads
// "one . more" and does not match the carried "one". Once the body lands
// with its line break, ". more" is no longer part of the definition, and
// the two texts would match.

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

describe("bug: a cut whose join hands the carried definition a lazy continuation", () => {
    // the selection: the blank line under the definition and "alpha[^1]", so
    // ". more" joins onto the line under "[^1]: one" as its lazy continuation
    const note = ["[^1]: one", "", "alpha[^1]. more"];
    const from = { line: 1, ch: 0 };
    const to = { line: 2, ch: 9 };

    it("cut then paste back at the caret gives the note back, with one definition", () => {
        const after = cut(note, from, to);
        const back = paste(after.lines, after.caret, after.clip);
        // Today the note reads "[^1]: one", "[^2]: one", "", "alpha[^2]. more".
        expect(back.lines.join("\n")).not.toContain("[^1-2]");
        expect(back.lines.join("\n")).not.toContain("[^2]");
        expect(back.lines.filter((line) => line.endsWith(": one")).length).toBe(1);
    });
});
