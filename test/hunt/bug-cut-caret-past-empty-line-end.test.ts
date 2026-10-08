import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (annoyance): a cut that starts at the end of the definition it takes
// leaves the caret past the end of the line that definition emptied, and a
// paste straight back does not give the note back.
//
// What the user would see: the note is "Intro", "", "[^a]: def", "",
// "Para[^a].". They drag from the end of "Para[^a]." up to the end of the
// definition's line, to take the paragraph with the blank line above it,
// and press Ctrl+X. The note becomes "Intro", "", "", and the definition
// went along, as it should. Pressing Ctrl+V right away, the note comes
// back as "Intro", "", "", "", "Para[^a].", "", "[^a]: def": a fresh paste
// with the definition at the bottom, not the note as it was.
//
// The plugin puts the caret at ch 9 of that emptied line, line 2. A real
// CodeMirror editor (the editor inside Obsidian) cannot hold a caret there:
// it throws on a position past the end of the line, or turns it into a
// place on another line. So the caret the cut remembers for its paste back
// can never be the caret the editor has, and the paste back never happens.
//
// A "paste back" is a paste of the plugin's own last cut, into the note
// that cut left unchanged, at the place the cut left the caret; it restores
// the note as it was before the cut.
//
// Hunt 2026-10-08, cycle 6. Cluster Z16.
//
// Origin: regression from 5b62064 (the cut keeps the caret's line); the
// paste back came with fad92e0.
//
// Source of truth: Jason's ruling Q5, option (a) (2026-10-07), as 5b62064
// states it: a definition on the line the editor's own cut leaves the
// caret on goes while the line stays, empty, and the caret is on that
// line. The README: "A cut pasted straight back (the note unchanged since
// the cut, the caret where the cut left it, nothing selected) gives the
// note back exactly as it was."
//
// Cause: planCut in src/commands/carry-footnotes.ts gives the caret as
// the line it kept and the column the selection started at
// ({ line: keptLine, ch: from.ch }). When the cut empties that line, the
// column is never brought back to the line's new end.

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
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
type Pos = { line: number; ch: number };
/** A fake editor holding `lines`, with the selection running from `from` to `to`. */
function editor(lines: string[], from: Pos, to = from): FakeEditor {
    return fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}
const on = { carryFootnotesOnCopy: true, lintOnFootnoteCreation: false };
/** A fake plugin whose active note is `doc`. */
function pluginIn(doc: FakeEditor): FootnotePlugin {
    const plugin = fakePlugin(on, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path: "note.md" } }) };
    return plugin;
}
/** The text from `from` to `to`, as the editor's own copy would take it. */
function sliceText(lines: string[], from: Pos, to: Pos): string {
    if (from.line === to.line) return lines[from.line].slice(from.ch, to.ch);
    return [lines[from.line].slice(from.ch), ...lines.slice(from.line + 1, to.line), lines[to.line].slice(0, to.ch)].join("\n");
}
/**
 * Cuts `from` to `to`; returns the note, the clipboard text, whether the
 * plugin took the cut over, and the caret it left. A cut the plugin leaves
 * to the editor is worked out as the editor's own cut would leave it.
 */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCut(pluginIn(doc), event as never);
    const taken = event.defaultPrevented;
    const after = taken ? doc.lines.slice() : [...lines.slice(0, from.line), lines[from.line].slice(0, from.ch) + lines[to.line].slice(to.ch), ...lines.slice(to.line + 1)];
    return { lines: after, clip: taken ? event.written["text/plain"] : sliceText(lines, from, to), taken, caret: taken ? doc.cursor : from };
}
/** Pastes `clip` at `at`; returns the editor. */
function paste(lines: string[], at: Pos, clip: string) {
    const doc = editor(lines, at);
    handlePaste(pluginIn(doc), clipboardEvent(clip) as never, doc);
    return doc;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a cut that starts at the end of the definition it takes", () => {
    const note = ["Intro", "", "[^a]: def", "", "Para[^a]."];

    // Now: the caret is at { line: 2, ch: 9 } on the empty line 2.
    it("the caret it leaves is inside the line it is on", () => {
        const c = cut(note, { line: 2, ch: 9 }, { line: 4, ch: 9 });
        expect(c.taken).toBe(true);
        expect(c.lines).toEqual(["Intro", "", ""]);
        expect(c.caret.ch, JSON.stringify(c)).toBeLessThanOrEqual(c.lines[c.caret.line].length);
    });

    // Now: "Intro", "", "", "", "Para[^a].", "", "[^a]: def". The paste is
    // made at the end of the empty line, where the editor shows the caret.
    it("pasted straight back where the editor shows the caret (the end of that empty line), the note comes back exactly", () => {
        const c = cut(note, { line: 2, ch: 9 }, { line: 4, ch: 9 });
        const at = { line: c.caret.line, ch: Math.min(c.caret.ch, c.lines[c.caret.line].length) };
        const back = paste(c.lines, at, c.clip);
        expect(back.lines, JSON.stringify({ c, back: back.lines })).toEqual(note);
    });

    // Now: the caret is at { line: 0, ch: 19 } on the empty line 0.
    it("a definition of two lines, cut from the end of its continuation line: the caret is inside its line", () => {
        const twoLines = ["[^note]: alpha", "    continued alpha", "", "alpha[^Note].", "", "tail"];
        const c = cut(twoLines, { line: 1, ch: 19 }, { line: 3, ch: 13 });
        expect(c.taken).toBe(true);
        expect(c.caret.ch, JSON.stringify(c)).toBeLessThanOrEqual(c.lines[c.caret.line].length);
    });

    it("control: the same paragraph cut from the start of its own line keeps a valid caret and pastes back", () => {
        const c = cut(note, { line: 4, ch: 0 }, { line: 4, ch: 9 });
        expect(c.caret.ch).toBeLessThanOrEqual(c.lines[c.caret.line].length);
        expect(paste(c.lines, c.caret, c.clip).lines).toEqual(note);
    });
});
