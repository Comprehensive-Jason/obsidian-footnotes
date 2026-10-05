import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { resetCarryRegister, wrapClipboardCommands } from "../../src/commands/carry-footnotes-hooks";

// BUG (data loss, conditional): on a phone, when something goes wrong
// after the carry has already written, Obsidian's own Cut or Paste runs
// as well, on top of what the carry did.
//
// What the user would see: on a phone, the toolbar's Paste carries the
// footnotes in, and then an error happens (in the tests below, a setting
// read that throws). The plugin falls back to Obsidian's own paste, so
// the text lands a second time, raw. With Cut, the carry has already
// taken the text and its definition out of the note and put them on the
// clipboard; Obsidian's own cut then runs on the now-empty selection and
// writes "" to the clipboard, so the cut text is gone from both places.
//
// The trigger is fault-injected: no real error after the write is known
// today. The tests make one up to show what the fallback would do.
//
// Hunt 2026-10-05, round 1, lens carry. Cluster CA5.
//
// Source of truth: wrapClipboardCommands' own promise (commit 9d66167):
// Obsidian's own action runs "when anything throws", as the fallback for
// a carry that could not happen; a cut "keeps the copy and leaves the
// note" when it cannot finish. Running both is never what either path
// means.
//
// Cause: the try/catch around each wrapped command covers the whole
// carry, its write to the note and the clipboard included, and on any
// error falls back to Obsidian's original action, whether or not the
// carry already wrote.

/** Obsidian 1.14's mobile commands, as read off app.js: cut writes the selection then replaces it with ""; paste replaces the selection with the clipboard text. */
function obsidianCommands(clip: { text: string; written: string[] }) {
    const calls: string[] = [];
    return {
        calls,
        commands: {
            "editor:cut": {
                editorCallback: async (e: FakeEditor) => {
                    calls.push("cut");
                    const text = e.getSelection();
                    clip.written.push(text);
                    clip.text = text;
                    await Promise.resolve();
                    e.replaceSelection("");
                },
            },
            "editor:copy": {
                editorCallback: async (e: FakeEditor) => {
                    calls.push("copy");
                    clip.written.push(e.getSelection());
                    await Promise.resolve();
                },
            },
            "editor:paste": {
                editorCallback: async (e: FakeEditor) => {
                    calls.push("paste");
                    await Promise.resolve();
                    e.replaceSelection(clip.text);
                },
            },
        } as Record<string, { editorCallback: (e: FakeEditor) => Promise<void> }>,
    };
}

/** A stand-in for the plugin on a phone: its settings, the command registry holding `commands`, and `doc` as the active editor. */
function phonePlugin(doc: FakeEditor, settings: object, commands: object) {
    const disposers: (() => void)[] = [];
    const plugin = {
        settings,
        app: { commands: { commands }, workspace: { getActiveViewOfType: () => ({ editor: doc }) }, vault: {} },
        register: (dispose: () => void) => disposers.push(dispose),
    } as unknown as FootnotePlugin;
    return plugin;
}

/** A fake editor with getSelection and replaceSelection, as Obsidian's own commands use them. */
function editor(lines: string[], from: { line: number; ch: number }, to = from): FakeEditor {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const sel = () => {
        const s = doc.listSelections()[0];
        const a = s.anchor;
        const b = s.head;
        return a.line < b.line || (a.line === b.line && a.ch <= b.ch) ? [a, b] : [b, a];
    };
    Object.assign(doc, {
        getSelection: () => {
            const [a, b] = sel();
            if (a.line === b.line) return doc.lines[a.line].slice(a.ch, b.ch);
            return [doc.lines[a.line].slice(a.ch), ...doc.lines.slice(a.line + 1, b.line), doc.lines[b.line].slice(0, b.ch)].join("\n");
        },
        replaceSelection: (text: string) => {
            const [a, b] = sel();
            doc.transaction({ changes: [{ from: a, to: b, text }] });
        },
    });
    return doc;
}

let clip: { text: string; written: string[] };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
    clip = { text: "", written: [] };
    // The phone's clipboard, which the wrapped commands reach through navigator.clipboard.
    vi.stubGlobal("navigator", {
        clipboard: {
            writeText: (text: string) => {
                clip.written.push(text);
                clip.text = text;
                return Promise.resolve();
            },
            readText: () => Promise.resolve(clip.text),
        },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("a wrapped command whose carry already wrote does not also run Obsidian's own action", () => {
    it("paste: an error after the carried text landed does not paste it a second time", async () => {
        const doc = editor(["x", ""], { line: 1, ch: 0 });
        const settings = {
            carryFootnotesOnCopy: true,
            get lintOnFootnoteCreation(): boolean {
                throw new Error("simulated failure after the write");
            },
        };
        const { commands, calls } = obsidianCommands(clip);
        wrapClipboardCommands(phonePlugin(doc, settings, commands));
        clip.text = "a[^1] b\n\n[^1]: one";
        await commands["editor:paste"].editorCallback(doc);
        // Today: calls ["paste"], and "a[^1] b" plus the raw "[^1]: one" land twice.
        expect(calls).toEqual([]);
        expect(doc.lines.filter((l) => l.includes("a[^1] b")).length).toBe(1);
    });

    it("cut: an error after the cut was made does not run Obsidian's cut, which overwrites the clipboard", async () => {
        const doc = editor(["keep a[^1] b", "", "[^1]: one"], { line: 0, ch: 5 }, { line: 0, ch: 12 });
        // CodeMirror's error for a caret placed past the note's end, thrown after the cut.
        Object.assign(doc, {
            setCursor: () => {
                throw new RangeError("Invalid line number");
            },
        });
        const { commands, calls } = obsidianCommands(clip);
        wrapClipboardCommands(phonePlugin(doc, { carryFootnotesOnCopy: true }, commands));
        await commands["editor:cut"].editorCallback(doc);
        // The note lost the text and its definition ...
        expect(doc.lines.join("\n")).not.toContain("[^1]");
        // ... so the clipboard must still hold them. Today Obsidian's cut ran
        // on the now-empty selection and wrote "" over them.
        expect(calls).toEqual([]);
        expect(clip.text).toBe("a[^1] b\n\n[^1]: one");
    });
});
