import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MarkdownView } from "obsidian";
import type { EditorPosition } from "obsidian";

import type FootnotePlugin from "../../src/main";
import { fakeEditor, type FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";
import { PasteNestedNotice } from "../../src/editor/notice";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { dismissFootnotePopup, openFootnotePopup, settleFootnotePopupWithFeedback, toggleCloseFootnotePopup } from "../../src/commands/footnote-popup";

// spec question: should a paste that carries footnotes be allowed to land
// inside another footnote, with the caret in a definition's body or
// inside an inline footnote?
//
// What it does now: the paste is taken over as anywhere else. The pasted
// reference lands inside the other footnote, so one footnote is nested in
// another, and its definition is added at the bottom as usual. Inside an
// inline footnote ("^[inline ]") this happens with no word at all.
// What a user might expect: the plugin prevents nesting everywhere else
// (ADR 0001), so either the paste is refused with a toast, or the text
// lands without the footnote machinery, or it lands and lint flags it.
// Why it is a question and not a bug: ADR 0001 covers what the plugin
// creates, and a paste is the user's own text arriving. The ADR also says
// hand-typed nesting is "surfaced by lint, never" destroyed, so landing it
// and leaving lint to speak is one defensible reading. Which way pastes go
// is Jason's call.
//
// Hunt 2026-10-02, round 1, lens carry-hook. Cluster C20.
//
// Answered for the first two cases (Jason's rulings B4 and 4, 2026-10-07
// and 2026-10-08, stage 3 of the result gate design): the result gate
// refuses the paste as nested, nothing is pasted, and the notice says
// "Nothing was pasted: the pasted footnotes would land inside another
// footnote." They were it.fails until then.
//
// Source of truth: docs/adr/0001-no-nested-footnotes.md ("We refuse to
// create nesting anywhere") and CONTEXT.md's Nested footnote entry
// ("Prevented plugin-wide").
//
// Added 2026-10-06 (hunt 2026-10-06, cycle 3, lens carry, cluster K7):
// two more cases of the same question, where the pasted footnote is
// merged into the very definition the paste lands in, so that definition
// ends up citing itself. See the last describe block. Origin: the
// main-editor case is pre-existing; the popup case is new since cec4352,
// from 1c6a871, which plans a paste in the popup against the whole note
// (before it, the popup's paste saw no definition to merge into).

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
// to `to` (the same place when nothing is selected).
function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a paste that carries footnotes, with the caret inside another footnote", () => {
    it("a paste with the caret on a definition line does not nest a footnote inside that definition: nothing is pasted", () => {
        const dest = editor(["a[^1]", "", "[^1]: one "], { line: 2, ch: 10 });
        const event = clipboardEvent("c[^7]\n\n[^7]: seven");
        handlePaste(fakePlugin(on, dest), event as never, dest);
        // Before the ruling line 2 became "[^1]: one c[^7]".
        expect(dest.lines[2]).not.toContain("[^7]");
        expect(dest.lines).toEqual(["a[^1]", "", "[^1]: one "]);
        expect(event.defaultPrevented).toBe(true);
        expect(noticed(PasteNestedNotice)).toBe(true);
    });

    it("a paste inside an inline footnote does not nest a footnote: nothing is pasted", () => {
        const dest = editor(["a^[inline ] b"], { line: 0, ch: 10 });
        handlePaste(fakePlugin(on, dest), clipboardEvent("c[^7]\n\n[^7]: seven") as never, dest);
        // Before the ruling line 0 became "a^[inline c[^7]] b".
        expect(dest.lines[0]).not.toMatch(/\^\[inline c\[\^7\]/);
        expect(dest.lines).toEqual(["a^[inline ] b"]);
        expect(noticed(PasteNestedNotice)).toBe(true);
    });
});

// The cases added 2026-10-06 (hunt 2026-10-06, cycle 3, lens carry,
// cluster K7). The pasted footnote's definition has the same text as the
// definition the paste lands in, so the paste reuses that very
// definition: the pasted reference takes its name, and the definition
// ends up citing itself ("[^1]: the source see[^1]"). It happens with the
// caret at the end of a definition line in the note, and in the footnote
// popup open on that footnote. The same question as above: should a
// paste be allowed to nest a footnote inside another, here inside itself?
//
// The popup case opens the popup over a modelled embed, the same model as
// the pin bug-carry-paste-into-popup-ignores-note: the embed holds one
// definition's text in the popup's editor and joins it back into the note
// on every change, with a tab after each line break. The popup reaches
// for `window` and MutationObserver, which the test environment lacks;
// stand-ins go in for the run and come out after.
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
    const mainEditor = valueEditor(note);
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
        vault: { cachedRead: () => Promise.resolve(mainEditor.getValue()) },
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
                        mainEditor.setValue(e.data as string);
                    };
                    e.loadFile = () => {
                        const text = mainEditor.getValue();
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
        editor: mainEditor,
        containerEl: { ownerDocument: doc, contains: () => false },
        get data() {
            return mainEditor.getValue();
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
    return { editor: mainEditor, popup: shown, plugin };
}

async function closePopup() {
    expect(toggleCloseFootnotePopup()).toBe(true);
    await settleFootnotePopupWithFeedback();
}

// These two pass since the fix for cluster M2 (hunt 2026-10-06 cycle 3,
// pin bug-cut-kept-definition-lazy-join-paste-back): the paste reads the
// note's definitions with the pasted text already in place, so the
// definition the paste lands in no longer reads "the source" and is not
// offered for a merge. That is option (a) of the triage's Q7, which
// Jason has not ruled on yet; if he picks (b), these change.
describe("spec question: a paste merged into the very definition it lands in", () => {
    it("a paste inside a definition's own text is not merged into that same definition (no self-citing definition)", () => {
        const dest = editor(["Mine[^1].", "", "[^1]: the source"], { line: 2, ch: "[^1]: the source".length });
        handlePaste(fakePlugin(on, dest), clipboardEvent(" see[^7]\n\n[^7]: the source") as never, dest);
        const def = dest.lines.find((l) => l.startsWith("[^1]:")) ?? "";
        // Today the line reads "[^1]: the source see[^1]".
        expect(def.slice(5)).not.toContain("[^1]");
    });

    it("a pasted footnote is not merged into the very footnote the popup is editing (no self-citing definition)", async () => {
        const { editor: main, popup, plugin } = await openPopup("Mine[^1].\n\n[^1]: the source", "1");
        handlePaste(plugin, clipboardEvent(" see[^7]\n\n[^7]: the source") as never, popup);
        await closePopup();
        // [^1]'s own definition does not cite [^1]; today it reads "[^1]: the source see[^1]"
        const def = main.getValue().split("\n").find((l) => l.startsWith("[^1]:")) ?? "";
        expect(def.slice(5)).not.toContain("[^1]");
    });
});
