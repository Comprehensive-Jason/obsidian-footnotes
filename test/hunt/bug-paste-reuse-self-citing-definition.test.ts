import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// BUG (annoyance): a paste no longer reuses an identical definition that
// cites itself, or two definitions that cite each other, so it adds a
// renamed duplicate.
//
// What the user would see: a footnote's definition mentions its own
// footnote ("[^9]: alpha" with "continued sees [^9]" under it), or two
// definitions cite each other ("[^a]: see [^b]", "[^b]: see [^a]"). The
// user cuts or copies text citing it and pastes it back into the same
// note. Instead of reusing the footnote the note already has, the paste
// adds a copy of the definition under a new name ([^1], or [^a-2] and
// [^b-2]) and points the pasted reference at it. A cut and a paste back
// at the same place does not give the note back.
//
// Hunt 2026-10-06, cycle 3, lens mix (interactions). Cluster M1.
//
// Origin: regression (since cec4352, from 3ed178d, which made
// planCarriedPaste the one planner for every name a paste brings).
//
// Source of truth: the README's Paste paragraph ("A definition the
// destination already has (same text, whatever its name) is reused"),
// and the README's Cut paragraph (a definition still used elsewhere
// "stays in the note and travels as a copy", so pasting it back finds it).
//
// Cause: decide() inside planCarriedPaste in
// src/commands/carry-footnotes.ts refuses to merge a block that cites a
// name the paste defines and has not merged yet. A block citing itself
// cites its own name, which is never merged before its own decision, and
// in a cycle each block waits on the other. So neither is ever compared
// with the destination's definitions.

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

/** Cuts from..to out of a note holding `lines`; returns the note, the clipboard text, and the caret after the cut. */
function cut(lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(fakePlugin(settings, doc), event as never);
    return { lines: doc.lines.slice(), clip: event.written["text/plain"], taken: event.defaultPrevented, caret: doc.cursor };
}

/** Pastes `clip` into a note holding `lines` with the caret at `at`; returns the note. */
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

// Each case: a title, the destination note, the pasted body, and the
// definitions the paste carries. The destination already shows each
// carried definition's text.
const cases: [string, string[], string, { name: string; lines: string[] }[]][] = [
    ["self-citing body", ["[^9]: alpha", "    continued sees [^9]", "", "x"], "alpha[^9]", [{ name: "9", lines: ["[^9]: alpha", "    continued sees [^9]"] }]],
    ["self-citing one-liner", ["[^9]: see [^9]", "", "x"], "alpha[^9]", [{ name: "9", lines: ["[^9]: see [^9]"] }]],
    ["two definitions citing each other", ["[^a]: see [^b]", "[^b]: see [^a]", "", "x"], "alpha[^a]", [{ name: "a", lines: ["[^a]: see [^b]"] }, { name: "b", lines: ["[^b]: see [^a]"] }]],
];

describe("bug: paste reuse of identical definitions that cite themselves", () => {
    for (const [title, destination, body, carried] of cases) {
        it(`reuses the identical definition: ${title}`, () => {
            const plan = planCarriedPaste(destination.join("\n"), body, carried, { line: destination.length - 1, ch: 1 });
            // Today the plan adds the carried definitions again, renamed.
            expect(plan.added).toBe(0);
            expect(plan.body).toBe(body);
        });
    }

    it("cut then paste back at the caret reuses the identical definition", () => {
        // The definition's own text cites [^9], so the cut keeps it in the
        // note and carries a copy; the paste back should find it.
        const note = ["[^9]: alpha", "    continued sees [^9]", "", "alpha[^9]."];
        const after = cut(note, { line: 3, ch: 0 }, { line: 3, ch: 9 });
        const back = paste(after.lines, after.caret, after.clip);
        // Today the paste adds "[^1]: alpha" / "    continued sees [^1]" and lands "alpha[^1].".
        expect(back.lines).toEqual(note);
    });
});
