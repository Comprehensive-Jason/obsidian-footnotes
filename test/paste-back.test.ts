import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEditor, FakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";
import type FootnotePlugin from "../src/main";
import { carriedInputHandler, handleCut, handlePaste, resetCarryRegister, wrapClipboardCommands } from "../src/commands/carry-footnotes-hooks";

// A cut pasted back is an undo (ADR 0003, rule 2; Jason's rulings
// 2026-10-07). The carry register remembers, for a cut, the note before
// it, the note right after it, the caret it left, and the file. A paste of
// that cut's text into that file, while its text is exactly the note the
// cut left, at that caret with nothing selected, writes the note before
// the cut back exactly, names and blank lines included, and puts the caret
// at the end of the restored text. It compares texts, so it works the same
// for the paste event, the phone's Paste command, and the phone keyboard's
// clipboard history.

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

function editor(lines: string[], from: Pos, to = from): FakeEditor {
    return fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true, lintOnFootnoteCreation: false };

/** A plugin whose open note is `doc`, in the file at `path`. */
function pluginIn(doc: FakeEditor, path = "note.md"): FootnotePlugin {
    const plugin = fakePlugin(on, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path } }) };
    return plugin;
}

/** The text between `from` and `to` in `lines`. */
function sliceText(lines: string[], from: Pos, to: Pos): string {
    if (from.line === to.line) return lines[from.line].slice(from.ch, to.ch);
    return [lines[from.line].slice(from.ch), ...lines.slice(from.line + 1, to.line), lines[to.line].slice(0, to.ch)].join("\n");
}

/** Cuts from..to out of `lines` in the file at `path`; the note after, the clipboard, and the caret (the editor's own cut when the plugin leaves it). */
function cut(lines: string[], from: Pos, to: Pos, path = "note.md") {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCut(pluginIn(doc, path), event as never);
    const taken = event.defaultPrevented;
    const after = taken ? doc.lines.slice() : [...lines.slice(0, from.line), lines[from.line].slice(0, from.ch) + lines[to.line].slice(to.ch), ...lines.slice(to.line + 1)];
    return { lines: after, clip: taken ? event.written["text/plain"] : sliceText(lines, from, to), taken, caret: taken ? doc.cursor : from };
}

/** Pastes `clip` over `at`..`to` into `lines` in the file at `path`; the editor afterwards and whether the plugin took the paste. */
function paste(lines: string[], at: Pos, clip: string, to: Pos = at, path = "note.md") {
    const doc = editor(lines, at, to);
    const event = clipboardEvent(clip);
    handlePaste(pluginIn(doc, path), event as never, doc);
    return { doc, taken: event.defaultPrevented };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a cut pasted back gives the note back", () => {
    // the plugin takes this cut over: "[^a]: def" goes with the paragraph
    const note = ["Intro", "", "[^a]: def", "", "Para[^a].", "", "tail"];
    const from = { line: 4, ch: 0 };
    const to = { line: 4, ch: 9 };

    it("the plugin's own cut, pasted at the caret it left, restores the note exactly, and the caret goes to the end of the restored text", () => {
        const c = cut(note, from, to);
        expect(c.taken).toBe(true);
        const back = paste(c.lines, c.caret, c.clip);
        expect(back.taken).toBe(true);
        expect(back.doc.lines).toEqual(note);
        expect(back.doc.cursor).toEqual(to);
        expect(messages().filter((m) => m.startsWith("Pasted"))).toEqual([]);
    });

    it("a cut the editor makes (the selection holds the whole definition), pasted back, keeps the definition's name", () => {
        const lines = ["Text[^1]. More[^2].", "", "[^1]: one", "", "[^2]: two"];
        const c = cut(lines, { line: 2, ch: 0 }, { line: 3, ch: 0 });
        expect(c.taken).toBe(false);
        const back = paste(c.lines, c.caret, c.clip);
        expect(back.doc.lines).toEqual(lines);
        expect(back.doc.cursor).toEqual({ line: 3, ch: 0 });
    });

    it("is not a paste back once the note has changed: the paste is planned as usual", () => {
        const c = cut(note, from, to);
        const changed = [...c.lines];
        changed[0] = "Intro edited";
        const back = paste(changed, c.caret, c.clip);
        expect(back.doc.lines[0]).toBe("Intro edited");
        expect(back.doc.lines).not.toEqual(note);
    });

    it("is not a paste back at another caret", () => {
        const c = cut(note, from, to);
        const back = paste(c.lines, { line: 0, ch: 0 }, c.clip);
        expect(back.doc.lines).not.toEqual(note);
    });

    it("is not a paste back over a selection", () => {
        const c = cut(note, from, to);
        const back = paste(c.lines, { line: 0, ch: 0 }, c.clip, { line: 0, ch: 5 });
        expect(back.doc.lines).not.toEqual(note);
    });

    it("is not a paste back in another file whose text happens to match", () => {
        const c = cut(note, from, to, "one.md");
        const back = paste(c.lines, c.caret, c.clip, c.caret, "two.md");
        expect(back.doc.lines).not.toEqual(note);
    });

    it("is not a paste back of another text", () => {
        const c = cut(note, from, to);
        const back = paste(c.lines, c.caret, "Other[^z].\n\n[^z]: zed");
        expect(back.doc.lines).not.toEqual(note);
    });

    it("the phone keyboard's clipboard history (the input method) restores it too", () => {
        const c = cut(note, from, to);
        const doc = editor(c.lines, c.caret);
        const handle = carriedInputHandler(pluginIn(doc), () => doc);
        const at = doc.posToOffset(c.caret);
        expect(handle({} as never, at, at, c.clip)).toBe(true);
        expect(doc.lines).toEqual(note);
        expect(doc.cursor).toEqual(to);
    });
});

describe("the phone's Paste command pastes a cut back", () => {
    beforeEach(() => {
        vi.stubGlobal("navigator", { clipboard: { readText: () => Promise.resolve(clip), writeText: () => Promise.resolve() } });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    let clip = "";

    it("restores the note the cut left", async () => {
        const note = ["Intro", "", "[^a]: def", "", "Para[^a].", "", "tail"];
        const c = cut(note, { line: 4, ch: 0 }, { line: 4, ch: 9 });
        clip = c.clip;
        const doc = editor(c.lines, c.caret);
        const paste = { editorCallback: (_editor: unknown) => Promise.resolve() };
        const plugin = pluginIn(doc);
        (plugin.app as unknown as { commands: unknown }).commands = { commands: { "editor:paste": paste } };
        (plugin as unknown as { register: (f: () => void) => void }).register = () => undefined;
        wrapClipboardCommands(plugin);
        await paste.editorCallback(doc);
        expect(doc.lines).toEqual(note);
    });
});
