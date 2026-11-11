import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MarkdownView } from "obsidian";
import type { EditorPosition } from "obsidian";

import type FootnotePlugin from "../../src/main";
import {
    dismissFootnotePopup,
    openFootnotePopup,
    settleFootnotePopupWithFeedback,
    toggleCloseFootnotePopup,
} from "../../src/commands/footnote-popup";

// Bug (data loss, popup save-back family): when the popup closes while
// the definition it edits is no longer in the note, the embed's fallback
// save writes the WHOLE FILE as the embed last knew it, wiping every edit
// the user made in the main editor meanwhile and resurrecting the
// definition they deleted.
//
// Note text (creation flow, popup open on footnote 1):
//   Text[^1] more
//
//   [^1]:
// The user types "the definition" in the popup (embed dirty), and the
// embed's own 2-second debounced save is IN FLIGHT when they close the
// popup with the hotkey. The teardown then waits seconds for that save
// (the `embed.saving` loop in domTeardown), and in that window the user
// deletes the definition line (an undo of the creation, or a hand delete)
// and types " typed" in the prose above.
//
// Observed: the note comes back as the embed's stale join:
//   Text[^1] more
//
//   [^1]: the definition
// The user's " typed" is gone and the deleted definition is back.
//
// Expected: the user's edits survive. This is the same rule the pinned
// U3/U4/U5 family (test/hunt/bug-popup-save-back-wipes-main-editor-edits)
// established for the main editor being "the only writer once the popup
// closes": whatever the popup's own text does, edits the user made after
// closing are never wiped by the popup's save. For a definition that is
// gone, dropping the popup's text (a notice saying so would be best) is
// the only outcome that keeps that promise; the probe asserts the " typed"
// edit survives, whichever way the definition is settled.
//
// Cause: writeThroughMainEditor returns false when definitionSection
// finds no definition of the name (src/commands/footnote-popup.ts,
// "Reports false only when the definition is gone from the note, in which
// case the embed stays the writer"), and the fallback then calls
// embed.save(text, true), whose join uses the embed's STALE before/after.
// The header comment on writeThroughMainEditor says that save-back used to
// wipe the user's typing and the fix re-finds the definition in the
// CURRENT note; this shape (the definition deleted while the popup was up)
// still takes the old stale whole-file write.
//
// The fake popup and fake embed follow the shape obsidian-internals.ts
// documents, copied from the pinned U3/U4/U5 file so both probes model
// the embed the same way. `saving` is forced true at close, with a
// saveGate that the test releases after the user's edit, exactly the
// in-flight-save wait the real teardown sits through.
//
// Found by the GLM 5.3 review (2026-11-11); Jason chose to fix it.

const g = globalThis as unknown as Record<string, unknown>;
let hadWindow = false;
let hadMO = false;
beforeAll(() => {
    hadWindow = "window" in g;
    hadMO = "MutationObserver" in g;
    if (!hadWindow) g.window = globalThis;
    if (!hadMO)
        g.MutationObserver = class {
            observe() {}
            disconnect() {}
        };
});
afterAll(() => {
    dismissFootnotePopup();
    if (!hadMO) delete g.MutationObserver;
});

function valueEditor(initial: string, caret: EditorPosition) {
    let value = initial;
    let cursor = caret;
    const lines = () => value.split("\n");
    const posToOffset = (pos: EditorPosition) => {
        const ls = lines();
        let off = 0;
        for (let i = 0; i < pos.line; i++) off += ls[i].length + 1;
        return off + pos.ch;
    };
    const offsetToPos = (offset: number): EditorPosition => {
        const ls = lines();
        let rest = offset;
        for (let i = 0; i < ls.length; i++) {
            if (rest <= ls[i].length) return { line: i, ch: rest };
            rest -= ls[i].length + 1;
        }
        return { line: ls.length - 1, ch: ls[ls.length - 1].length };
    };
    return {
        getValue: () => value,
        setValue: (v: string) => {
            value = v;
        },
        getLine: (n: number) => lines()[n],
        lineCount: () => lines().length,
        lastLine: () => lines().length - 1,
        getCursor: () => cursor,
        setCursor: (pos: EditorPosition) => {
            cursor = pos;
        },
        listSelections: () => [{ anchor: cursor, head: cursor }],
        focus() {},
        posToOffset,
        offsetToPos,
        getScrollInfo: () => ({ top: 0, left: 0 }),
        transaction(spec: { changes?: { from: EditorPosition; to?: EditorPosition; text: string }[] }) {
            const changes = (spec.changes ?? [])
                .map((c) => ({ from: posToOffset(c.from), to: posToOffset(c.to ?? c.from), text: c.text }))
                .sort((a, b) => b.from - a.from);
            for (const c of changes) value = value.slice(0, c.from) + c.text + value.slice(c.to);
        },
        insertAt(offset: number, text: string) {
            value = value.slice(0, offset) + text + value.slice(offset);
        },
        removeLine(line: number) {
            const ls = lines();
            ls.splice(line, 1);
            value = ls.join("\n");
        },
    };
}

function fakeEl(): Record<string, unknown> {
    return {
        offsetHeight: 0,
        setCssProps() {},
        addClass() {},
        removeClass() {},
        createDiv: () => fakeEl(),
        querySelector: () => null,
        contains: () => false,
        remove() {},
        empty() {},
        style: {},
    };
}

async function popupRoundWhileSaveInFlight(opts: {
    note: string[];
    caret: EditorPosition;
    name: string;
    popupText: string;
    edit: (editor: ReturnType<typeof valueEditor>) => void;
}): Promise<string> {
    const editor = valueEditor(opts.note.join("\n"), opts.caret);
    const win = {
        setTimeout: (f: () => void, ms?: number) => window.setTimeout(f, ms),
        clearTimeout: (t: ReturnType<typeof setTimeout>) => {
            window.clearTimeout(t);
        },
        innerWidth: 1200,
        innerHeight: 900,
        ResizeObserver: class {
            observe() {}
            disconnect() {}
        },
        getSelection: () => null,
        getComputedStyle: () => ({}),
    };
    const doc = {
        body: { createDiv: () => fakeEl() },
        defaultView: win,
        activeElement: null,
        addEventListener() {},
        removeEventListener() {},
    };
    const file = { path: "note.md" };
    let embed: Record<string, unknown> | null = null;
    let releaseSave: () => void = () => {};
    const app = {
        workspace: {
            getActiveViewOfType: () => mdView,
            on: () => ({}),
            offref() {},
            getLeavesOfType: () => [],
        },
        keymap: { pushScope() {}, popScope() {} },
        scope: {},
        vault: { cachedRead: () => Promise.resolve(editor.getValue()) },
        metadataCache: { on: () => ({}), offref() {} },
        embedRegistry: {
            embedByExtension: {
                md: (_ctx: unknown, _file: unknown, subpath: string) => {
                    const name = subpath.slice(3, -1); // "#[^name]"
                    const e: Record<string, unknown> = {
                        popupText: "",
                        dirty: false,
                        saving: true, // the embed's own save is in flight at close
                        saveAgain: false,
                        subpathNotFound: false,
                        data: "",
                        diskWrites: [] as string[],
                        editable: false,
                        load() {},
                        unload() {},
                        showEditor() {},
                        requestSave: { cancel() {} },
                        requestSaveFolds: { cancel() {} },
                        editMode: {
                            editor: {
                                focus() {},
                                getValue: () => e.popupText as string,
                                lastLine: () => 0,
                                getLine: () => e.popupText as string,
                                setCursor() {},
                            },
                        },
                        loadFile: () => {
                            const text = editor.getValue();
                            const lines = text.split("\n");
                            let off = 0;
                            for (const line of lines) {
                                const m = /^((?:> ?)*)\[\^([^\]]+)\]: ?/.exec(line);
                                if (m && m[2].toLowerCase() === name) {
                                    const labelEnd = off + m[0].length;
                                    const lineEnd = off + line.length;
                                    e.before = text.slice(0, labelEnd);
                                    e.text = text.slice(labelEnd, lineEnd);
                                    e.after = text.slice(lineEnd);
                                    e.popupText = e.text;
                                    return Promise.resolve();
                                }
                                off += line.length + 1;
                            }
                            e.subpathNotFound = true;
                            return Promise.resolve();
                        },
                        save: async (t: string, write: boolean) => {
                            await saveGate;
                            // the in-flight save lands: no longer saving
                            e.saving = false;
                            e.data = `${(e.before as string | undefined) ?? ""}${t}${(e.after as string | undefined) ?? ""}`;
                            if (write) {
                                (e.diskWrites as string[]).push(e.data as string);
                                // Obsidian folds the written file back into the open view
                                editor.setValue(e.data as string);
                                e.dirty = false;
                            }
                        },
                    };
                    const saveGate = new Promise<void>((resolve) => {
                        releaseSave = resolve;
                    });
                    embed = e;
                    return e;
                },
            },
        },
    };
    const mdView = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
        app,
        file,
        editor,
        containerEl: { ownerDocument: doc, contains: () => false },
        get data() {
            return editor.getValue();
        },
        save: () => Promise.resolve(),
        getMode: () => "source",
    });
    const plugin = { app, settings: { enablePopupEditor: true } } as unknown as FootnotePlugin;

    await openFootnotePopup(plugin, opts.name, () => {
        throw new Error("the popup fell back to the jump");
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const shown = embed as { popupText: string; dirty: boolean } | null;
    if (!shown) throw new Error("no embed was built");
    // the user writes the definition in the popup
    shown.popupText = opts.popupText;
    shown.dirty = true;
    // the user closes it with the hotkey while the embed's save is in flight
    expect(toggleCloseFootnotePopup()).toBe(true);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // during the teardown's wait for that save, the user edits the main note
    opts.edit(editor);
    // the in-flight save lands, writing the file as it stood (nothing new),
    // so the teardown's wait ends here
    (embed as unknown as { saving: boolean }).saving = false;
    releaseSave();
    await settleFootnotePopupWithFeedback();
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    return editor.getValue();
}

describe("the popup's save-back and a definition deleted while the popup was up", () => {
    it("an undo that removes the definition (and the user's typing after it) is not wiped by the popup's fallback save", async () => {
        const result = await popupRoundWhileSaveInFlight({
            note: ["Text[^1] more", "", "[^1]: "],
            caret: { line: 0, ch: 8 },
            name: "1",
            popupText: "the definition",
            edit: (ed) => {
                // what a Ctrl+Z of the creation leaves, plus typing carried on:
                // the definition line deleted, and " typed" added in the prose
                ed.removeLine(2);
                ed.insertAt("Text[^1]".length, " typed");
            },
        });
        // Before the fix: "Text[^1] more\n\n[^1]: the definition" - " typed"
        // is gone and the deleted definition is back.
        // Expected: the note exactly as the user left it (the blank line
        // above the deleted definition stays); the popup's text has no
        // definition to land in, so it is dropped.
        expect(result).toBe("Text[^1] typed more\n");
    });
});
