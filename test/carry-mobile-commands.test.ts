import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEditor, FakeEditor } from "./helpers/fake-editor";
import { messages, resetNotices } from "./helpers/notices";
import type FootnotePlugin from "../src/main";
import { resetCarryRegister, wrapClipboardCommands } from "../src/commands/carry-footnotes-hooks";

// Obsidian's own Cut, Copy, and Paste commands on a phone ("editor:cut",
// "editor:copy", "editor:paste", the mobile toolbar's buttons) write and
// read the clipboard through navigator.clipboard, so no clipboard event
// fires and the copy, cut, and paste hooks never heard them: footnote
// definitions did not travel that way (read off Obsidian 1.14's app.js,
// 2026-10-04; Jason chose to carry them, option 2). wrapClipboardCommands
// wraps each command's action: the plugin carries when there is something
// to carry, and Obsidian's own action runs otherwise.

/** One of Obsidian's three commands, as its registry holds it, with a stand-in action that records being run. */
function command() {
    const calls: unknown[] = [];
    return {
        calls,
        editorCallback: (editor: unknown) => {
            calls.push(editor);
            return Promise.resolve();
        },
    };
}

type Command = ReturnType<typeof command>;

/** A plugin whose active note is `doc`, with Obsidian's three commands registered (on a phone), and a record of what it registered for unload. */
function phonePlugin(doc: FakeEditor, settings: Record<string, unknown> = { carryFootnotesOnCopy: true }) {
    const commands: Record<string, Command> = { "editor:copy": command(), "editor:cut": command(), "editor:paste": command() };
    const disposers: (() => void)[] = [];
    const plugin = {
        settings,
        app: {
            commands: { commands },
            workspace: { getActiveViewOfType: () => ({ editor: doc }) },
            vault: {},
        },
        register: (dispose: () => void) => disposers.push(dispose),
    } as unknown as FootnotePlugin;
    return { plugin, commands, unload: () => {
        for (const dispose of disposers) dispose();
    } };
}

function editor(lines: string[], from: { line: number; ch: number }, to = from): FakeEditor {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

/** The phone's clipboard: what was written, and what a read returns. */
let clipboard: { written: string[]; text: string; fail: boolean };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
    clipboard = { written: [], text: "", fail: false };
    vi.stubGlobal("navigator", {
        clipboard: {
            writeText: (text: string) => {
                if (clipboard.fail) return Promise.reject(new Error("denied"));
                clipboard.written.push(text);
                return Promise.resolve();
            },
            readText: () => Promise.resolve(clipboard.text),
        },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("Obsidian's Copy command on a phone", () => {
    it("writes the selection and the definitions it needs, and Obsidian's own copy does not run", async () => {
        const doc = editor(["a[^1] b", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 7 });
        const { plugin, commands } = phonePlugin(doc);
        const original = commands["editor:copy"].editorCallback;
        wrapClipboardCommands(plugin);
        await commands["editor:copy"].editorCallback(doc);
        expect(clipboard.written).toEqual(["a[^1] b\n\n[^1]: one"]);
        expect(commands["editor:copy"].calls).toEqual([]);
        expect(commands["editor:copy"].editorCallback).not.toBe(original);
    });

    it("leaves a selection that needs no definition to Obsidian's own copy", async () => {
        const doc = editor(["plain words", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 5 });
        const { plugin, commands } = phonePlugin(doc);
        wrapClipboardCommands(plugin);
        await commands["editor:copy"].editorCallback(doc);
        expect(clipboard.written).toEqual([]);
        expect(commands["editor:copy"].calls).toEqual([doc]);
    });

    it("leaves everything to Obsidian's own copy when the carry setting is off", async () => {
        const doc = editor(["a[^1] b", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 7 });
        const { plugin, commands } = phonePlugin(doc, { carryFootnotesOnCopy: false });
        wrapClipboardCommands(plugin);
        await commands["editor:copy"].editorCallback(doc);
        expect(clipboard.written).toEqual([]);
        expect(commands["editor:copy"].calls).toEqual([doc]);
    });

    it("falls back to Obsidian's own copy when the clipboard write fails", async () => {
        const doc = editor(["a[^1] b", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 7 });
        const { plugin, commands } = phonePlugin(doc);
        wrapClipboardCommands(plugin);
        clipboard.fail = true;
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        await commands["editor:copy"].editorCallback(doc);
        expect(commands["editor:copy"].calls).toEqual([doc]);
    });
});

describe("Obsidian's Cut command on a phone", () => {
    it("takes the text and the definition nothing else uses out of the note, and writes both to the clipboard", async () => {
        const doc = editor(["keep a[^1] b", "", "[^1]: one"], { line: 0, ch: 5 }, { line: 0, ch: 12 });
        const { plugin, commands } = phonePlugin(doc);
        wrapClipboardCommands(plugin);
        await commands["editor:cut"].editorCallback(doc);
        expect(clipboard.written).toEqual(["a[^1] b\n\n[^1]: one"]);
        expect(doc.lines.join("\n")).not.toContain("[^1]");
        expect(doc.lines[0]).toBe("keep ");
        expect(commands["editor:cut"].calls).toEqual([]);
        expect(messages().some((m) => m.startsWith("Cut with 1 footnote definition"))).toBe(true);
    });

    it("leaves a cut that needs no definition to Obsidian's own cut", async () => {
        const doc = editor(["plain words", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 5 });
        const { plugin, commands } = phonePlugin(doc);
        wrapClipboardCommands(plugin);
        await commands["editor:cut"].editorCallback(doc);
        expect(commands["editor:cut"].calls).toEqual([doc]);
        expect(doc.lines[0]).toBe("plain words");
    });
});

describe("Obsidian's Paste command on a phone", () => {
    it("lands the text with the definitions the clipboard carries, and Obsidian's own paste does not run", async () => {
        const doc = editor(["x[^1]", "", "[^1]: uno"], { line: 0, ch: 5 });
        const { plugin, commands } = phonePlugin(doc);
        wrapClipboardCommands(plugin);
        clipboard.text = "a[^1] b\n\n[^1]: one";
        await commands["editor:paste"].editorCallback(doc);
        expect(doc.lines).toEqual(["x[^1]a[^2] b", "", "[^1]: uno", "[^2]: one"]);
        expect(commands["editor:paste"].calls).toEqual([]);
    });

    it("leaves plain text to Obsidian's own paste", async () => {
        const doc = editor(["x"], { line: 0, ch: 1 });
        const { plugin, commands } = phonePlugin(doc);
        wrapClipboardCommands(plugin);
        clipboard.text = "just words";
        await commands["editor:paste"].editorCallback(doc);
        expect(commands["editor:paste"].calls).toEqual([doc]);
        expect(doc.lines).toEqual(["x"]);
    });
});

describe("wrapping Obsidian's commands safely", () => {
    it("puts Obsidian's own actions back when the plugin unloads", () => {
        const doc = editor(["x"], { line: 0, ch: 0 });
        const { plugin, commands, unload } = phonePlugin(doc);
        const originals = Object.fromEntries(Object.entries(commands).map(([id, c]) => [id, c.editorCallback]));
        wrapClipboardCommands(plugin);
        unload();
        for (const [id, c] of Object.entries(commands)) expect(c.editorCallback).toBe(originals[id]);
    });

    it("leaves a desktop alone, where Obsidian registers none of the three", () => {
        const plugin = { settings: {}, app: { commands: { commands: {} } }, register: () => undefined } as unknown as FootnotePlugin;
        expect(() => {
            wrapClipboardCommands(plugin);
        }).not.toThrow();
    });

    it("leaves a command alone when it has no action of the expected shape", () => {
        const odd = { callback: () => undefined };
        const plugin = { settings: {}, app: { commands: { commands: { "editor:copy": odd } } }, register: () => undefined } as unknown as FootnotePlugin;
        wrapClipboardCommands(plugin);
        expect(odd).toEqual({ callback: odd.callback });
    });

    it("leaves things alone when the app has no command registry at all", () => {
        const plugin = { settings: {}, app: {}, register: () => undefined } as unknown as FootnotePlugin;
        expect(() => {
            wrapClipboardCommands(plugin);
        }).not.toThrow();
    });
});
