import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MarkdownView } from "obsidian";
import type { EditorPosition } from "obsidian";

import type FootnotePlugin from "../../src/main";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { dismissFootnotePopup, openFootnotePopup, settleFootnotePopupWithFeedback, toggleCloseFootnotePopup } from "../../src/commands/footnote-popup";
import { fakeEditor, type FakeEditor } from "../helpers/fake-editor";
import { messages, resetNotices } from "../helpers/notices";
import { PasteNestedNotice } from "../../src/editor/notice";

// BUG (wrong output): a carried paste into the footnote popup lands a
// second definition of a name the note already uses.
//
// What the user would see: the note reads "Mine[^1] and more[^2]." with
// "[^1]: my own source" and an empty "[^2]: ", and the popup is open on
// [^2]. They paste "see x[^1]", copied in another note with its own [^1].
// Instead of renaming the pasted footnote to a name the note does not use,
// the paste keeps it as [^1], and the note ends up defining [^1] twice.
// Obsidian renders only the last definition of a name, so the user's own
// source is hidden, and "Mine[^1]" points at "their source".
//
// Hunt 2026-10-02, round 4, lens plumbing. Cluster U6.
//
// Live check (sandbox vault, Obsidian 1.13 desktop, app.isMobile false,
// 2026-10-06): a paste in the popup reaches the plugin's editor-paste hook,
// handed the popup's own editor (the embed's editMode.editor, the very
// same object); the active MarkdownView is still the note's. The plugin
// took the paste over and wrote "see x[^1]", a blank line, "# Footnotes"
// (the vault's Section heading setting is on), a blank line, and "[^1]:
// their source" into the popup. The embed joins the popup's text into the
// note with every line after its first indented by a tab, so all of it
// became [^2]'s own text, and the main editor showed that join at once:
// "[^2]: see x[^1]", then "\t", "\t# Footnotes", "\t", "\t[^1]: their
// source". The plugin's input handler (the phone keyboard's clipboard
// history) also runs in the popup's editor, found no note owning it, and
// left the text to land as typed, with the same second [^1].
//
// Rewritten 2026-10-06 (fix agent U6): the first version handed
// handlePaste a bare editor with no popup open, and joined the popup's
// text into the note without the indent, so it could not see where the
// carried definitions really go. This version opens a popup through
// openFootnotePopup over a modelled embed that joins the way the live
// check showed: the text before the definition, the popup's text with a
// tab after each line break, the text after, written into the main editor
// on every change of the popup's editor and on every save.
//
// Source of truth: the carry docstring in carry-footnotes-hooks.ts (the
// carried definitions go "where a creation press would put a definition,
// merged and renamed to fit the note"); the README's Paste paragraph; and
// navigation.ts's ground truth that Obsidian renders the LAST of two
// same-named definitions (2026-08-12).
//
// Severity: medium. One of the user's own definitions disappears from
// Reading view, silently.
//
// Cause: handlePaste planned its renames and placed its definitions
// against the editor it was handed. The popup's editor holds only one
// definition's text, so the planner saw no [^1] to clash with, and the
// definitions it placed there became part of that footnote.
//
// Fix (2026-10-06): the popup tells the paste which note it belongs to
// (footnotePopupSection); the paste is planned against the whole note, the
// pasted text goes into the popup, and the definitions go into the note
// where a creation press would put them, with the embed told about the new
// text around the popup's (PopupSection.around), so its next join keeps
// them.

// The popup reaches for `window` and MutationObserver, which the test
// environment lacks; stand-ins go in for the run and come out after.
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
beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});
afterEach(async () => {
    dismissFootnotePopup();
    await settleFootnotePopupWithFeedback();
});

/** A main editor backed by one string: edits splice offsets, so it shares nothing with the plugin's own change simulation. */
function valueEditor(initial: string) {
    let value = initial;
    let cursor: EditorPosition = { line: 0, ch: 0 };
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
    };
}

/** A stand-in for a DOM element: every call the popup makes on one is accepted and does nothing. */
function fakeEl(): Record<string, unknown> {
    const el: Record<string, unknown> = {
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
    return el;
}

/** A stand-in for the browser's paste event, holding `text` on the clipboard. */
function clipboardEvent(text: string) {
    const event = {
        defaultPrevented: false,
        clipboardData: { types: ["text/plain"], getData: (t: string) => (t === "text/plain" ? text : ""), setData() {} },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

/**
 * The popup open on footnote `name` of `note`, over a modelled embed. The
 * embed finds the first definition of that name (a one-line definition, as
 * every fixture here has), holds its text in the popup's editor, and joins
 * the popup's text back into the main editor on every change, with a tab
 * after each line break: what the live check saw. Returns the main editor,
 * the popup's editor, and the plugin.
 */
async function openPopup(note: string, name: string) {
    const editor = valueEditor(note);
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
    let popup: FakeEditor | null = null;
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
                    const wanted = subpath.slice(3, -1); // "#[^name]"
                    const e: Record<string, unknown> & { before?: string; after?: string; indent: string; heading: string; dirty: boolean } = {
                        indent: "\t",
                        heading: "",
                        dirty: false,
                        saving: false,
                        saveAgain: false,
                        subpathNotFound: false,
                        editable: false,
                        load() {},
                        unload() {},
                        showEditor() {},
                        requestSave: { cancel() {} },
                        requestSaveFolds: { cancel() {} },
                    };
                    // the embed's join, which Obsidian also shows in the main editor at once
                    const join = (text: string) => {
                        e.data = `${e.before ?? ""}${text.replace(/\n/g, `\n${e.indent}`)}${e.after ?? ""}`;
                        editor.setValue(e.data as string);
                    };
                    e.loadFile = () => {
                        const text = editor.getValue();
                        const lines = text.split("\n");
                        let off = 0;
                        for (const line of lines) {
                            const m = /^\[\^([^\]]+)\]: ?/.exec(line);
                            if (m && m[1].toLowerCase() === wanted) {
                                e.before = text.slice(0, off + m[0].length);
                                e.after = text.slice(off + line.length);
                                const section = line.slice(m[0].length);
                                const inner = fakeEditor([section], { wholeDoc: true, edits: true, cursor: { line: 0, ch: section.length } });
                                // every change of the popup's editor is joined into the note
                                const apply = inner.transaction.bind(inner);
                                Object.assign(inner, {
                                    focus() {},
                                    transaction(spec: Parameters<typeof apply>[0]) {
                                        apply(spec);
                                        e.dirty = true;
                                        join(inner.getValue());
                                    },
                                });
                                e.editMode = { editor: inner };
                                popup = inner;
                                return Promise.resolve();
                            }
                            off += line.length + 1;
                        }
                        e.subpathNotFound = true;
                        return Promise.resolve();
                    };
                    e.save = (t: string) => {
                        join(t);
                        return Promise.resolve();
                    };
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
    const plugin = { app, settings: { enablePopupEditor: true, carryFootnotesOnCopy: true } } as unknown as FootnotePlugin;
    await openFootnotePopup(plugin, name, () => {
        throw new Error("the popup fell back to the jump");
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const shown = popup as FakeEditor | null;
    if (!shown) throw new Error("the popup showed no editor");
    return { editor, popup: shown, plugin };
}

/** Close the popup with the hotkey and wait for its text to land in the note. */
async function closePopup() {
    expect(toggleCloseFootnotePopup()).toBe(true);
    await settleFootnotePopupWithFeedback();
}

// Since stage 3 of the result gate design (2026-10-08), a pasted text that
// cites a footnote is refused in the popup: its reference would sit inside
// the footnote the popup edits, a footnote inside a footnote (Jason's
// rulings B4 and 4, 2026-10-07 and 2026-10-08), so nothing is pasted. The
// first test below holds that refusal, with the user's own [^1] untouched;
// the others paste texts that cite nothing and carry a definition, which
// still go through the whole note's planning: renamed where the note uses
// the name, placed after its last definition, indented the popup's way,
// and reused when the note has the same text.
describe("a carried paste into the footnote popup", () => {
    it("does not land a second [^1] definition in a note that already defines [^1]: a text citing [^1] is refused", async () => {
        const { editor, popup, plugin } = await openPopup("Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: ", "2");
        // A clipboard copied in another note: "see x[^1]" carrying its own [^1].
        const took = handlePaste(plugin, clipboardEvent("see x[^1]\n\n[^1]: their source") as never, popup);
        const whileOpen = { took, popup: popup.getValue(), note: editor.getValue() };
        await closePopup();
        const note = editor.getValue();
        const definitionsOf1 = note.split("\n").filter((line) => /^\s*\[\^1\]:/.test(line));
        // Before the fix: two definitions of [^1], the user's and "[^1]: their source".
        expect(definitionsOf1).toEqual(["[^1]: my own source"]);
        expect(whileOpen).toEqual({ took: true, popup: "", note: "Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: " });
        expect(note).toBe("Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: ");
        expect(messages()).toContain(PasteNestedNotice);
    });

    it("renames a carried definition the note's name would clash with", async () => {
        const { editor, popup, plugin } = await openPopup("Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: ", "2");
        const took = handlePaste(plugin, clipboardEvent("see x\n\n[^1]: their source") as never, popup);
        expect({ took, popup: popup.getValue() }).toEqual({ took: true, popup: "see x" });
        await closePopup();
        expect(editor.getValue()).toBe("Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: see x\n[^3]: their source");
        expect(messages()).toContain("Pasted with 1 footnote definition: 1 added, 1 renamed.");
    });

    it("puts the definitions after the note's last definition when the popup's footnote is not the last", async () => {
        const { editor, popup, plugin } = await openPopup("A[^1] b[^2].\n\n[^1]: \n[^2]: two", "1");
        handlePaste(plugin, clipboardEvent("see x\n\n[^2]: their source") as never, popup);
        expect(popup.getValue()).toBe("see x");
        await closePopup();
        expect(editor.getValue()).toBe("A[^1] b[^2].\n\n[^1]: see x\n[^2]: two\n[^3]: their source");
    });

    it("keeps a pasted text of several lines in the footnote, indented the way the popup's lines are", async () => {
        const { editor, popup, plugin } = await openPopup("Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: ", "2");
        handlePaste(plugin, clipboardEvent("line one\nline two\n\n[^1]: their source") as never, popup);
        expect(popup.getValue()).toBe("line one\nline two");
        // the caret sits right after the pasted text, in the popup
        expect(popup.cursor).toEqual({ line: 1, ch: "line two".length });
        await closePopup();
        expect(editor.getValue()).toBe("Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: line one\n\tline two\n[^3]: their source");
    });

    it("reuses a definition the note already has, without adding one", async () => {
        const { editor, popup, plugin } = await openPopup("Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: ", "2");
        handlePaste(plugin, clipboardEvent("see also\n\n[^1]: my own source") as never, popup);
        expect(popup.getValue()).toBe("see also");
        await closePopup();
        expect(editor.getValue()).toBe("Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: see also");
    });
});
