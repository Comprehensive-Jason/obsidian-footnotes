import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// spec question: when the clipboard holds only definition lines, and the
// note has references with those names but no definitions, should the
// paste supply the missing definitions instead of renaming them?
//
// What it does now: the note reads "x[^1]" with no [^1] definition. The
// user copies "[^1]: one" from another app and pastes it at the bottom.
// The paste sees that the note already uses the name 1 (as a reference),
// so it renames the pasted definition to [^2]. Now [^1] still has no
// definition, and nothing references the new [^2] footnote. Both sides
// end up orphaned.
// What a user might expect: pasting a definition for a reference that
// lacks one fills the gap, so the note gains "[^1]: one" and [^1] reads
// "one".
// Why it is a question and not a bug: the rename rule treats any name the
// destination uses, reference or definition, as taken, which is what
// keeps a pasted footnote from capturing a reference that belongs to
// something else. Whether a clipboard with no body is a different case,
// one where the user means to supply definitions, is a product decision
// for Jason.
//
// Hunt 2026-10-02, round 1, lens carry-hook. Cluster C27.
//
// Source of truth: planCarriedPaste's docstring, "a name the destination
// does not use (as a definition or a reference) is kept; a name the
// destination uses for a different body is renamed".

// A stand-in for the browser's clipboard event: it reads `text` and
// records what the plugin writes back.
function clipboardEvent(text = "") {
    const event = {
        written: {} as Record<string, string>,
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

// A fake editor holding `lines`, with the selection running from `from`
// to `to`.
function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a clipboard that is only a definition line, pasted where its reference has none", () => {
    it.fails("pasting [^1]: one into a note whose [^1] reference has no definition supplies that definition, not a renamed orphan", () => {
        const dest = editor(["x[^1]", "", ""], { line: 2, ch: 0 });
        handlePaste(fakePlugin(on, dest), clipboardEvent("[^1]: one") as never, dest);
        expect(dest.lines.join("\n")).toContain("[^1]: one");
        expect(dest.lines.join("\n")).not.toContain("[^2]");
    });
});

// Hunt 2026-10-06, cycle 5, lens round trip (cluster X23): the same
// mechanism inside one note, with the plugin's own cut and copy. The note
// reads "Text[^1]. More[^2].", "[^1]: one", and "[^2]: two", with blank
// lines between. Cutting [^1]'s line (Shift+Down, then Ctrl+X) and
// pasting it straight back, the most ordinary way to move a definition by
// hand, gives "[^3]: one" at the bottom: Text[^1] is left with no
// definition and nothing references [^3]. Copying the line and pasting it
// over itself does the same. The paste counts the note's own references
// as names in use, so the pasted definition is renamed away from the
// reference it served. These faces argue for ruling C27 a bug.
// (Origin: pre-existing.)

/** A line and a character in it. */
type Pos = { line: number; ch: number };

/** The text between `from` and `to` in `lines`. */
function sliceText(lines: string[], from: Pos, to: Pos): string {
    if (from.line === to.line) return lines[from.line].slice(from.ch, to.ch);
    return [lines[from.line].slice(from.ch), ...lines.slice(from.line + 1, to.line), lines[to.line].slice(0, to.ch)].join("\n");
}

/** Cuts from..to out of a note holding `lines`; returns the note, the clipboard text, whether the plugin took the cut, and the caret after it (the editor's own cut when the plugin left it alone). */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCut(fakePlugin(on, doc), event as never);
    const taken = event.defaultPrevented;
    const after = taken ? doc.lines.slice() : [...lines.slice(0, from.line), lines[from.line].slice(0, from.ch) + lines[to.line].slice(to.ch), ...lines.slice(to.line + 1)];
    return { lines: after, clip: taken ? event.written["text/plain"] : sliceText(lines, from, to), taken, caret: taken ? doc.cursor : from };
}

/** The clipboard text a copy of `from` to `to` leaves: the plugin's, or the editor's own when the plugin leaves the copy alone. */
function copy(lines: string[], from: Pos, to: Pos): string {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCopy(fakePlugin(on, doc), event as never);
    return event.defaultPrevented ? event.written["text/plain"] : sliceText(lines, from, to);
}

/** Pastes `clip` over `at`..`to` in a note holding `lines`; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], at: Pos, clip: string, to: Pos = at) {
    const doc = editor(lines, at, to);
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(on, doc), event as never, doc);
    return { lines: doc.lines.slice(), taken: event.defaultPrevented };
}

/** Every live reference outside a definition, paired with the text of its definition ("<orphan>" when none). */
function pairing(lines: string[]): string[] {
    const reading = readNote(lines);
    const bodies = new Map<string, string>();
    for (const d of reading.definitions) bodies.set(d.name.toLowerCase(), [lines[d.start].slice(d.labelEnd), ...lines.slice(d.start + 1, d.end + 1)].join("\n").trim());
    return reading.references
        .filter((r) => r.live && reading.definitionAt(r.line) === null)
        .map((r) => `${r.name}=${bodies.get(r.name.toLowerCase()) ?? "<orphan>"}`);
}

describe("spec question: a definition line cut or copied within one note and pasted back keeps serving its reference", () => {
    const note = ["Text[^1]. More[^2].", "", "[^1]: one", "", "[^2]: two"];

    it.fails("cut [^1]'s line (Shift+Down), paste it back at the caret: [^1] still serves Text[^1]", () => {
        const c = cut(note, { line: 2, ch: 0 }, { line: 3, ch: 0 });
        // the selection holds the whole label, so the cut is the editor's own
        expect(c.taken).toBe(false);
        expect(c.lines).toEqual(["Text[^1]. More[^2].", "", "", "[^2]: two"]);
        const back = paste(c.lines, c.caret, c.clip);
        expect(back.taken).toBe(true);
        const ctx = JSON.stringify({ clip: c.clip, back: back.lines, toasts: messages() });
        // Today "[^3]: one" is appended and Text[^1] is an orphan; the toast says "1 renamed".
        expect(pairing(back.lines), ctx).toEqual(pairing(note));
        expect(readNote(back.lines).definitions.map((d) => d.name).sort(), ctx).toEqual(["1", "2"]);
    });

    it.fails("copy a definition's line and paste it over itself (an accidental Ctrl+C, Ctrl+V)", () => {
        const from = { line: 2, ch: 0 };
        const to = { line: 3, ch: 0 };
        const back = paste(note, from, copy(note, from, to), to);
        expect(back.taken).toBe(true);
        const ctx = JSON.stringify({ back: back.lines, toasts: messages() });
        expect(pairing(back.lines), ctx).toEqual(pairing(note));
        expect(readNote(back.lines).definitions.map((d) => d.name).sort(), ctx).toEqual(["1", "2"]);
    });
});
