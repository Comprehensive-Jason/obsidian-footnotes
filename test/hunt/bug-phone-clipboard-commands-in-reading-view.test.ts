import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { resetCarryRegister, wrapClipboardCommands } from "../../src/commands/carry-footnotes-hooks";

// Bug: on a phone, Obsidian's own Cut, Copy, and Paste commands (the mobile
// toolbar's buttons), which the plugin wraps to carry footnotes, did not
// check for Reading view, while the copy, cut, and paste hooks do: in
// Reading view the editor's buffer is hidden, and the plugin never edits
// it (the 2026-08-08 rule). A Cut from the toolbar with a selection left in
// the hidden buffer could have cut text out of a note the user was only
// reading. Now the three commands leave Reading view to Obsidian's own
// action, as the hooks do.
//
// Found by the GLM 5.3 review (2026-11-11); Jason chose to fix it. Whether
// Obsidian runs these commands in Reading view at all needs a phone check;
// the guard makes the two routes the same either way.

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

/** A phone plugin whose active note is `doc`, shown in `mode` ("preview" is Reading view). */
function phonePlugin(doc: FakeEditor, mode: string) {
    const commands: Record<string, Command> = { "editor:copy": command(), "editor:cut": command(), "editor:paste": command() };
    const plugin = {
        settings: { carryFootnotesOnCopy: true },
        app: {
            commands: { commands },
            workspace: { getActiveViewOfType: () => ({ editor: doc, getMode: () => mode }) },
            vault: {},
        },
        register: () => undefined,
    } as unknown as FootnotePlugin;
    return { plugin, commands };
}

let clipboard: { written: string[]; text: string };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
    clipboard = { written: [], text: "" };
    vi.stubGlobal("navigator", {
        clipboard: {
            writeText: (text: string) => {
                clipboard.written.push(text);
                return Promise.resolve();
            },
            readText: () => Promise.resolve(clipboard.text),
        },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const note = ["a[^1] b", "", "[^1]: one"];
const selected = { from: { line: 0, ch: 0 }, to: { line: 0, ch: 7 } };

function editor(): FakeEditor {
    return fakeEditor([...note], { wholeDoc: true, edits: true, cursor: selected.to, selection: { anchor: selected.from, head: selected.to } });
}

describe("the phone's clipboard commands in Reading view", () => {
    it("Cut leaves the hidden note alone and runs Obsidian's own cut", async () => {
        const doc = editor();
        const { plugin, commands } = phonePlugin(doc, "preview");
        wrapClipboardCommands(plugin);
        await commands["editor:cut"].editorCallback(doc);
        expect(doc.lines).toEqual(note);
        expect(clipboard.written).toEqual([]);
        expect(commands["editor:cut"].calls).toEqual([doc]);
    });

    it("Copy runs Obsidian's own copy", async () => {
        const doc = editor();
        const { plugin, commands } = phonePlugin(doc, "preview");
        wrapClipboardCommands(plugin);
        await commands["editor:copy"].editorCallback(doc);
        expect(clipboard.written).toEqual([]);
        expect(commands["editor:copy"].calls).toEqual([doc]);
    });

    it("Paste runs Obsidian's own paste", async () => {
        const doc = editor();
        clipboard.text = "x[^2]\n\n[^2]: two";
        const { plugin, commands } = phonePlugin(doc, "preview");
        wrapClipboardCommands(plugin);
        await commands["editor:paste"].editorCallback(doc);
        expect(doc.lines).toEqual(note);
        expect(commands["editor:paste"].calls).toEqual([doc]);
    });

    // Characterization: in the editor the commands still carry.
    it("in the editor, Copy carries the definition (as before)", async () => {
        const doc = editor();
        const { plugin, commands } = phonePlugin(doc, "source");
        wrapClipboardCommands(plugin);
        await commands["editor:copy"].editorCallback(doc);
        expect(clipboard.written).toEqual(["a[^1] b\n\n[^1]: one"]);
        expect(commands["editor:copy"].calls).toEqual([]);
    });
});
