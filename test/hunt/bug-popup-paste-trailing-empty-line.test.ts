import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MarkdownView } from "obsidian";
import type { EditorPosition } from "obsidian";

import type FootnotePlugin from "../../src/main";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { dismissFootnotePopup, openFootnotePopup, settleFootnotePopupWithFeedback, toggleCloseFootnotePopup } from "../../src/commands/footnote-popup";
import { fakeEditor, type FakeEditor } from "../helpers/fake-editor";
import { resetNotices } from "../helpers/notices";

// BUG (wrong output): a carried paste into the footnote popup whose text
// ends in an empty line is left to the editor, and the pasted definition
// goes into the footnote's own text.
//
// What the user would see: the note reads "Mine[^1] and more[^2]." with
// "[^1]: my own source", and [^2]'s definition is "first" with an empty
// line under it (the user pressed Enter at the end of it in the popup).
// With the popup open on [^2] and the caret back at the end of "first",
// they paste " see x[^1]" copied from another note with its own
// "[^1]: their source". The plugin does not take the paste over, so the
// editor pastes the raw clipboard: the definition line lands inside
// [^2]'s text, and the note now defines [^1] twice. Obsidian shows only
// the last definition of a name, so the user's own source is hidden.
// This is the bug the pin bug-carry-paste-into-popup-ignores-note fixed,
// back again for this shape of popup.
//
// Hunt 2026-10-06, cycle 3, lens carry. Cluster K4.
//
// Origin: pre-existing (a new face of the popup paste path 1c6a871 added).
//
// Source of truth: the pin bug-carry-paste-into-popup-ignores-note (a
// carried paste in the popup is planned against the whole note, and its
// definitions go into the note where a creation press would put them),
// and the carry docstring in src/commands/carry-footnotes-hooks.ts.
//
// Cause: landCarriedText plans the definitions against the whole note,
// and the append (planDefinitionAppend) puts the new definition between
// the popup's two lines, after "first" and before the empty last line.
// PopupSection.around in src/commands/footnote-popup.ts then finds the
// popup's new text neither right after the text before it nor right
// before the text after it, returns null, and landCarriedText gives the
// paste back to the editor.

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

type Opts = { selection?: { anchor: EditorPosition; head: EditorPosition }; settings?: Record<string, unknown> };

/**
 * The popup open on footnote `name` of `note`, over a modelled embed. The
 * embed finds the first definition of that name (a one-line definition, as
 * every fixture here has), holds its text in the popup's editor, and joins
 * the popup's text back into the main editor on every change, with a tab
 * after each line break: what the live check saw. Returns the main editor,
 * the popup's editor, and the plugin.
 */

async function openPopup(note: string, name: string, opts: Opts = {}) {
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
                    const wanted = subpath.slice(3, -1);
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
                    const join = (text: string) => {
                        e.data = `${e.before ?? ""}${text.replace(/\n/g, `\n${e.indent}`)}${e.after ?? ""}`;
                        editor.setValue(e.data as string);
                    };
                    e.loadFile = () => {
                        const text = editor.getValue();
                        const lines = text.split("\n");
                        let off = 0;
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            const m = /^\[\^([^\]]+)\]: ?/.exec(line);
                            if (m && m[1].toLowerCase() === wanted) {
                                // the section: the label line, then every line indented by the tab
                                let last = i;
                                while (last + 1 < lines.length && lines[last + 1].startsWith("\t")) last++;
                                const sectionLines = [line.slice(m[0].length), ...lines.slice(i + 1, last + 1).map((l) => l.slice(1))];
                                let end = off;
                                for (let k = i; k <= last; k++) end += lines[k].length + 1;
                                end -= 1;
                                e.before = text.slice(0, off + m[0].length);
                                e.after = text.slice(end);
                                const lastLine = sectionLines.length - 1;
                                const caret = { line: lastLine, ch: sectionLines[lastLine].length };
                                const inner = fakeEditor(sectionLines, {
                                    wholeDoc: true,
                                    edits: true,
                                    cursor: opts.selection?.head ?? caret,
                                    selection: opts.selection ?? { anchor: caret, head: caret },
                                });
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
    const plugin = { app, settings: { enablePopupEditor: true, carryFootnotesOnCopy: true, ...(opts.settings ?? {}) } } as unknown as FootnotePlugin;
    await openFootnotePopup(plugin, name, () => {
        throw new Error("the popup fell back to the jump");
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const shown = popup as FakeEditor | null;
    if (!shown) throw new Error("the popup showed no editor");
    return { editor, popup: shown, plugin };
}

async function closePopup() {
    expect(toggleCloseFootnotePopup()).toBe(true);
    await settleFootnotePopupWithFeedback();
}

describe("bug: a carried paste in a popup whose text ends in an empty line", () => {
    it.fails("a paste in a popup whose text ends in an empty line still takes the paste over and lands the definition in the note", async () => {
        // the popup holds "first" and an empty second line (Enter pressed at its end); the caret is back at the end of "first"
        const at = { line: 0, ch: "first".length };
        const { editor, popup, plugin } = await openPopup("Mine[^1] and more[^2].\n\n[^1]: my own source\n[^2]: first\n\t", "2", { selection: { anchor: at, head: at } });
        expect(popup.getValue()).toBe("first\n");
        const took = handlePaste(plugin, clipboardEvent(" see x[^1]\n\n[^1]: their source") as never, popup);
        // When the plugin declines, the editor pastes the raw clipboard, and
        // the definition line goes into the popup. Today `took` is false.
        expect(took).toBe(true);
        await closePopup();
        const note = editor.getValue();
        expect(note.split("\n").filter((l) => /^\s*\[\^1\]:/.test(l))).toEqual(["[^1]: my own source"]);
    });
});
