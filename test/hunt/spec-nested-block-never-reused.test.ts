import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// spec question: when text citing a footnote whose definition holds
// another footnote's definition (a nested footnote) is pasted back into
// the same note, should the paste reuse the definitions already there,
// as it does for every other footnote?
//
// What it does now: the note reads "Outer[^a].", then "[^a]: outer
// text" with "    [^b]: inner text" indented under it, so [^b] is
// defined inside [^a]'s text. The user copies the paragraph "Outer[^a]."
// and pastes it further down the same note. The paste adds a renamed
// copy, "[^a-2]: outer text" holding "    [^b-2]: inner text", and the
// pasted reference reads [^a-2]: the note now holds two copies of both
// footnotes. A cut of the paragraph pasted straight back does the same
// (while another paragraph still cites [^b], the cut leaves [^a] in the
// note, so the paste back finds it).
// What a user might expect: as with any other footnote, the paste finds
// that the note already defines [^a] with the same text and reuses it:
// nothing added, the toast says "reused".
// Why it is a question and not a bug: the planner reuses a pasted block
// only when every footnote named in it pairs up with one the note has,
// and it never pairs a held definition on purpose, since that
// definition's lines are part of the block that holds it. So a block
// that holds one never matches. The shape is rare, and the plugin's own
// lint already warns that nested footnotes do not survive export.
// Whether the paste should reuse such a block when the whole block
// matches is Jason's call.
//
// Hunt 2026-10-06, cycle 5, lens round trip. Cluster X24.
//
// Origin: pre-existing.
//
// Source of truth: the README's Paste paragraph (a footnote whose text
// matches one the destination already has is reused, so a paste back
// adds nothing), and planCarriedPaste's comment in
// src/commands/carry-footnotes.ts ("Only a name the paste defines once
// can be merged. A held definition cannot ...").

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

/** A line and a character in it. */
type Pos = { line: number; ch: number };

/** A fake editor holding `lines`, with the selection running from `from` to `to` (a bare caret when `to` is left out). */
const editor = (lines: string[], from: Pos, to = from) => fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });

/** Copies from..to in a note holding `lines`; returns the clipboard text the plugin wrote and whether it took the copy over. */
function copy(lines: string[], from: Pos, to: Pos) {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCopy(fakePlugin(settings, doc), event as never);
    return { clip: event.written["text/plain"], taken: event.defaultPrevented };
}

/** Cuts from..to out of a note holding `lines`; returns the note, the clipboard text, whether the plugin took the cut, and the caret after it. */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCut(fakePlugin(settings, doc), event as never);
    return { lines: doc.lines.slice(), clip: event.written["text/plain"], taken: event.defaultPrevented, caret: doc.cursor };
}

/** Pastes `clip` at `at` in a note holding `lines`; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], at: Pos, clip: string) {
    const doc = editor(lines, at);
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(settings, doc), event as never, doc);
    return { lines: doc.lines.slice(), taken: event.defaultPrevented };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

// Answered (Jason's rulings 2026-10-07: ADR 0003, rule 2, a cut pasted
// back is an undo; built in stage 4 of the result gate design,
// 2026-10-08). A paste of the last cut's text into the note the cut left,
// at the caret it left, writes the note before the cut back exactly, names
// and blank lines included, so the paste back below gives the note back.
// The test was it.fails until then; what it did before is described above.
describe("spec question: a footnote whose definition holds another is reused on a paste in the same note", () => {
    it.fails("copy the paragraph, paste it on a fresh line of the same note: [^a] is reused, nothing added", () => {
        const note = ["Outer[^a].", "", "[^a]: outer text", "", "    [^b]: inner text", "", "End."];
        expect(readNote(note).definitions.map((d) => d.name)).toEqual(["a", "b"]);
        const c = copy(note, { line: 0, ch: 0 }, { line: 1, ch: 0 });
        expect(c.taken).toBe(true);
        const host = [...note, "", "Host "];
        const back = paste(host, { line: host.length - 1, ch: 5 }, c.clip);
        expect(back.taken).toBe(true);
        const ctx = JSON.stringify({ clip: c.clip, back: back.lines, toasts: messages() });
        // Today "[^a-2]: outer text" with "    [^b-2]: inner text" is added and the pasted reference reads [^a-2].
        expect(readNote(back.lines).definitions.map((d) => d.name), ctx).toEqual(["a", "b"]);
        expect(messages().join("\n"), ctx).toContain("reused");
    });

    it("cut the paragraph citing the outer footnote while another paragraph cites the held one, paste it back", () => {
        const note = ["Outer[^a].", "", "Inner too[^b].", "", "[^a]: outer text", "", "    [^b]: inner text", "", "End."];
        const c = cut(note, { line: 0, ch: 0 }, { line: 1, ch: 0 });
        expect(c.taken).toBe(true);
        // [^a] is orphaned by the cut but holds [^b], still cited, so it stays (ruling 2026-10-05)
        expect(c.lines).toEqual(["", "Inner too[^b].", "", "[^a]: outer text", "", "    [^b]: inner text", "", "End."]);
        const back = paste(c.lines, c.caret, c.clip);
        expect(back.taken).toBe(true);
        const ctx = JSON.stringify({ clip: c.clip, back: back.lines, toasts: messages() });
        // Before the paste back (stage 4, 2026-10-08): the paragraph comes back as "Outer[^a-2]." with a renamed copy of both footnotes added.
        expect(readNote(back.lines).definitions.map((d) => d.name), ctx).toEqual(["a", "b"]);
        expect(back.lines, ctx).toEqual(note);
    });
});
