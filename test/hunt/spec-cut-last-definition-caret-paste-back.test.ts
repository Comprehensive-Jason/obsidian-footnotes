import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: after a cut that takes the note's last definition out,
// where should the caret rest, so that a paste straight back does not
// join the pasted paragraph onto the definition above it?
//
// What it does now: the note reads "Intro[^2].", "[^2]: other",
// "alpha[^1]. alpha", and "[^1]: alpha" at the end, with blank lines
// between. The user selects from the blank line under "[^2]: other"
// through the "alpha[^1]. alpha" paragraph and its line break, and cuts.
// The cut also takes "[^1]: alpha" out, the note's last lines, so the
// line the caret was on no longer exists, and the caret lands at the end
// of "[^2]: other". Pasting straight back there puts "alpha[^1]. alpha"
// right under "[^2]: other", where Obsidian reads it as more of [^2]'s
// definition (a lazy continuation: a line that carries on the paragraph
// above it without being indented), so the paragraph and its reference
// vanish into the footnote.
// What a user might expect: a cut and a paste back at the same place
// gives the note back, with the paragraph its own paragraph.
// Why it is a question and not a bug: the caret goes to the nearest
// place left in the note, and the pasted text starts with a line break
// of its own, so each half does what it promises; only the two together
// go wrong. Options:
//   (a) the cut keeps an empty last line for the caret, where the
//       selection was (recommended);
//   (b) a paste at the end of a definition line whose text starts with a
//       line break gets a blank line first;
//   (c) accept it as it is.
// Which way to go is Jason's call.
//
// Hunt 2026-10-06, cycle 3, lens mix (interactions). Cluster M6.
//
// Origin: pre-existing.
//
// Source of truth: asOwnParagraph's docstring in
// src/commands/carry-footnotes-hooks.ts (a paste right under a definition
// gets a blank line in front so it does not read as that definition's
// lazy continuation), and ADR 0001 (no nested footnotes).

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

// Hunt 2026-10-06, cycle 5, lens round trip (cluster X25): the lead case
// of this question, mid-note. The note reads "Intro", "[^a]: def",
// "Para[^a].", and "tail", with blank lines between. The user selects the
// text of the line "Para[^a]." (not its line break) and cuts. The cut
// takes "[^a]: def", which sits ABOVE the selection, along, and tidies the
// blank lines around it, and with them the empty line the selection left
// behind, so the caret lands at the start of "tail". Pasting straight
// back writes "Para[^a].tail": two paragraphs glued into one line.
// Option (a) above answers this face too: the cut keeps the emptied line
// for the caret. (Origin: pre-existing.)
//
// Answered (Jason's rulings 2026-10-07: ADR 0003, rule 2, a cut pasted
// back is an undo; built in stage 4 of the result gate design,
// 2026-10-08). A paste of the last cut's text into the note the cut left,
// at the caret it left, writes the note before the cut back exactly, names
// and blank lines included, so the paste back below gives the note back.
// The test was it.fails until then; what it did before is described above.
describe("spec question: the caret after a cut that takes a definition above the selection out", () => {
    it("cut the line's text 'Para[^a].' and paste back: 'Para[^a].' and 'tail' stay separate paragraphs", () => {
        const note = ["Intro", "", "[^a]: def", "", "Para[^a].", "", "tail"];
        const after = cut(note, { line: 4, ch: 0 }, { line: 4, ch: 9 });
        expect(after.taken).toBe(true);
        const back = paste(after.lines, after.caret, after.clip);
        expect(back.taken).toBe(true);
        // Before the paste back (stage 4, 2026-10-08): the cut leaves ["Intro", "", "tail"] with the caret at the
        // start of "tail", and the paste back gives ["Intro", "", "Para[^a].tail", "", "[^a]: def"].
        expect(back.lines).not.toContain("Para[^a].tail");
        expect(back.lines.indexOf("tail") - back.lines.indexOf("Para[^a].")).toBeGreaterThan(1);
    });
});

// Answered (Jason's rulings 2026-10-07: ADR 0003, rule 2, a cut pasted
// back is an undo; built in stage 4 of the result gate design,
// 2026-10-08). A paste of the last cut's text into the note the cut left,
// at the caret it left, writes the note before the cut back exactly, names
// and blank lines included, so the paste back below gives the note back.
// The test was it.fails until then; what it did before is described above.
describe("spec question: the caret after a cut that takes the note's last definition out", () => {
    // the selection: the blank line under [^2]'s definition and the
    // paragraph citing [^1], through its line break
    const note = ["Intro[^2].", "", "[^2]: other", "", "alpha[^1]. alpha", "", "[^1]: alpha"];
    const from = { line: 3, ch: 0 };
    const to = { line: 5, ch: 0 };

    it("cut then paste back at the caret keeps the paragraph out of [^2]'s definition", () => {
        const after = cut(note, from, to);
        const back = paste(after.lines, after.caret, after.clip);
        const i = back.lines.indexOf("alpha[^1]. alpha");
        expect(i).toBeGreaterThan(0);
        // Before the paste back (stage 4, 2026-10-08): the line above the paragraph is "[^2]: other".
        expect(back.lines[i - 1].trim()).toBe("");
    });
});

// Answered for the caret too (Jason's ruling Q5, option (a), 2026-10-07;
// stage 4 of the result gate design, 2026-10-08): the cut's extra
// deletions, a definition it takes along and the empty section heading it
// tidies away, never remove the line the editor's own cut would leave the
// caret on, and the caret lands where the editor's plain cut would put it.
// Before, the caret went to the nearest place left in the note: the start
// of "tail" in the first case, the end of "[^2]: other" in the second.
describe("the caret after a cut that takes definitions along is where the editor's own cut would leave it", () => {
    it("a definition above the selection goes, and the line the selection emptied stays, with the caret on it", () => {
        const after = cut(["Intro", "", "[^a]: def", "", "Para[^a].", "", "tail"], { line: 4, ch: 0 }, { line: 4, ch: 9 });
        expect(after.taken).toBe(true);
        expect(after.lines).toEqual(["Intro", "", "", "", "tail"]);
        expect(after.caret).toEqual({ line: 2, ch: 0 });
    });

    it("the note's last definition goes, and the empty last line the caret is on stays", () => {
        const after = cut(["Intro[^2].", "", "[^2]: other", "", "alpha[^1]. alpha", "", "[^1]: alpha"], { line: 3, ch: 0 }, { line: 5, ch: 0 });
        expect(after.lines).toEqual(["Intro[^2].", "", "[^2]: other", ""]);
        expect(after.caret).toEqual({ line: 3, ch: 0 });
    });

    it("a definition on the line the caret would stand on goes, and the line stays, empty", () => {
        const after = cut(["Text[^1]", "", "[^1]: x", "", "more"], { line: 0, ch: 0 }, { line: 2, ch: 0 });
        expect(after.taken).toBe(true);
        expect(after.lines).toEqual(["", "", "more"]);
        expect(after.caret).toEqual({ line: 0, ch: 0 });
    });

    it("the empty section heading goes, and the line the caret is on stays", () => {
        const doc = fakeEditor(["Keep.", "", "Text[^1]", "", "# Footnotes", "", "[^1]: x"], { wholeDoc: true, edits: true, cursor: { line: 2, ch: 0 }, selection: { anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 8 } } });
        const event = clipboardEvent();
        handleCut(fakePlugin({ ...settings, enableFootnoteSectionHeading: true, removeEmptySectionHeading: true }, doc), event as never);
        expect(event.defaultPrevented).toBe(true);
        expect(doc.lines).toEqual(["Keep.", "", ""]);
        expect(doc.cursor).toEqual({ line: 2, ch: 0 });
    });

    it("control: a caret on a line of text is where the selection started", () => {
        const after = cut(["Intro", "", "One Para[^a]. two", "", "[^a]: def"], { line: 2, ch: 4 }, { line: 2, ch: 13 });
        expect(after.lines).toEqual(["Intro", "", "One  two"]);
        expect(after.caret).toEqual({ line: 2, ch: 4 });
    });
});
