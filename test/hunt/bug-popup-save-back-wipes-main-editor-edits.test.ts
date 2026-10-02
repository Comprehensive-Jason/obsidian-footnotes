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

// BUG (data loss, narrow window): when the footnote popup closes, its
// save-back can wipe what the user did in the main editor in the moment
// after.
//
// What the user would see: they write a definition in the popup, close it,
// and carry straight on in the note. In three shapes the edit they just
// made disappears a moment later:
// - U3: the popup's definition is the note's last line and something lands
//   below it right after closing (a carried paste appends its definition
//   there). The appended definition is deleted.
// - U4: a fenced code example or a %% comment further down holds a copy of
//   the same label ("[^1]: example"). Typing done above the definitions is
//   wiped.
// - U5: the definitions sit in a callout above the prose ("> [^1]: ").
//   Typing done below the callout is wiped.
// The window is narrow: the popup must close while its own two-second save
// is still being worked out, and the main note must change within about
// 80 ms. A smoke test in the B31 style (scripts/smoke-test.mjs, the test
// "typing right after the popup closes is never wiped by the popup's own
// save (B31, 2026-09-16)", which closes the popup and edits in one eval)
// would reproduce each one deterministically. U5 also needs a live check
// that the popup opens on a quoted definition at all.
//
// Hunt 2026-10-02, round 4, lens plumbing. Clusters U3, U4, and U5. They
// share one cause and one fake popup, so they share this file.
//
// Source of truth: the comment above writeThroughMainEditor in
// src/commands/footnote-popup.ts ("The note is read AFTER that join,
// because the user may already be typing in it: that typing is the whole
// point, and it must survive. The section is found by its label rather
// than by its old offset for the same reason"), and commit 590ca79 ("the
// main editor is the only writer once the popup closes ... found by its
// label so typing above it survives").
//
// Severity: high when it happens (the user's own text is lost), but rare.
//
// Cause: writeThroughMainEditor finds the end of the popup's section by
// two shortcuts. When the note still ends with the text that followed the
// section (`after`), the section is taken to run up to that text; with an
// empty `after` (U3) that is the end of the note, so whatever was appended
// below goes. When the label has moved, it is searched for with
// lastIndexOf on the raw text, which does not know about code or comments,
// so the fenced or commented copy is found instead (U4); and the fallback
// reads only left-margin definition blocks, so a quoted label forms no
// block (U5). In U4 and U5 the save-back gives up, and the popup's own
// stale save writes the whole file as it last knew it.
//
// The fake popup follows the shape obsidian-internals.ts documents:
// `before` is the file up to and including the label ("...[^1]: "),
// `after` the file after the section, save(text, false) fills `data` with
// before + text + after and writes nothing, and save(text, true) writes
// that joined text to disk, which Obsidian folds back into the open view.
// Obsidian's lookup takes the FIRST matching label (pinned in
// bug-duplicate-definition-popup).

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

/** A main editor backed by one string: edits splice offsets, and nothing shares the plugin's own change simulation. */
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
        /** an edit the user (or another route) makes in the main editor */
        insertAt(offset: number, text: string) {
            value = value.slice(0, offset) + text + value.slice(offset);
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

/** What the test reads back from the fake popup's embedded editor. */
interface FakeEmbed {
    popupText: string;
    dirty: boolean;
    saving: boolean;
    saveAgain: boolean;
    subpathNotFound: boolean;
    before?: string;
    after?: string;
    data?: string;
    text?: string;
    saveGate: Promise<void>;
    diskWrites: string[];
}

/**
 * The popup open on `name` over a note, with a modelled embed. `edit` runs
 * while the save-back's join is in flight: the moment B31 is about.
 */
async function popupRound(opts: {
    note: string[];
    caret: EditorPosition;
    name: string;
    popupText: string;
    /** what lands in the main editor after the popup closed, before the save-back reads the note */
    edit: (editor: ReturnType<typeof valueEditor>) => void;
}): Promise<{ text: string; diskWrites: string[] }> {
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
    let embed: FakeEmbed | null = null;
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
                    const e: FakeEmbed & Record<string, unknown> = {
                        popupText: "",
                        dirty: false,
                        saving: false,
                        saveAgain: false,
                        subpathNotFound: false,
                        saveGate: Promise.resolve(),
                        diskWrites: [],
                        editable: false,
                        load() {},
                        unload() {},
                        showEditor() {},
                        requestSave: { cancel() {} },
                        requestSaveFolds: { cancel() {} },
                        editMode: {
                            editor: {
                                focus() {},
                                getValue: () => e.popupText,
                                lastLine: () => 0,
                                getLine: () => e.popupText,
                                setCursor() {},
                            },
                        },
                        loadFile: () => {
                            // Obsidian's lookup: the FIRST label of that name, any casing
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
                            await e.saveGate;
                            e.data = `${e.before ?? ""}${t}${e.after ?? ""}`;
                            if (write) {
                                e.diskWrites.push(e.data);
                                // Obsidian folds the written file back into the open view
                                editor.setValue(e.data);
                                e.dirty = false;
                            }
                        },
                    };
                    e.saveGate = new Promise<void>((resolve) => {
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
    const shown = embed as FakeEmbed | null;
    if (!shown) throw new Error("no embed was built");
    // the user writes the definition in the popup
    shown.popupText = opts.popupText;
    shown.dirty = true;
    // the user closes it with the hotkey; the save-back's join starts
    expect(toggleCloseFootnotePopup()).toBe(true);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // while the join is in flight, the main editor changes
    opts.edit(editor);
    releaseSave();
    await settleFootnotePopupWithFeedback();
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    return { text: editor.getValue(), diskWrites: shown.diskWrites };
}

describe("U3: the popup's save-back and a definition appended below its own", () => {
    it.fails("a definition that lands BELOW the popup's own (a carried paste right after closing) is not wiped", async () => {
        // The popup's definition is the note's last line, so the embed's
        // `after` is "" and every note ends with it.
        const result = await popupRound({
            note: ["Text[^1] more", "", "[^1]: "],
            caret: { line: 0, ch: 8 },
            name: "1",
            popupText: "the definition",
            edit: (ed) => {
                // What the carried paste writes for a clipboard "pasted[^2]"
                // carrying "[^2]: carried": the text at the caret, and the
                // definition appended after the last definition block.
                const value = ed.getValue();
                ed.setValue(value + "\n[^2]: carried");
                ed.insertAt("Text[^1]".length, " pasted[^2]");
            },
        });
        // Today: the "[^2]: carried" line is gone.
        expect(result.text).toBe(["Text[^1] pasted[^2] more", "", "[^1]: the definition", "[^2]: carried"].join("\n"));
    });
});

describe("U4: the popup's save-back and a copy of the label below the definitions", () => {
    it("control: typing ABOVE the definition survives and the definition gets the popup's text", async () => {
        const result = await popupRound({
            note: ["Text[^1] more", "", "[^1]: "],
            caret: { line: 0, ch: 8 },
            name: "1",
            popupText: "the definition",
            edit: (ed) => {
                ed.insertAt("Text[^1]".length, " typed");
            },
        });
        expect(result.text).toBe(["Text[^1] typed more", "", "[^1]: the definition"].join("\n"));
    });

    it.fails("typing above survives when a fenced example of the same label sits below the definitions", async () => {
        // In Reading view the fenced "[^1]: example" is code, not a definition
        // (a fence at the left margin after a blank line ends the footnote),
        // so the popup's [^1] is the only definition.
        const result = await popupRound({
            note: ["Text[^1] more", "", "[^1]: ", "", "```", "[^1]: example", "```"],
            caret: { line: 0, ch: 8 },
            name: "1",
            popupText: "the definition",
            edit: (ed) => {
                ed.insertAt("Text[^1]".length, " typed");
            },
        });
        // Today: " typed" is gone.
        expect(result.text).toBe(
            ["Text[^1] typed more", "", "[^1]: the definition", "", "```", "[^1]: example", "```"].join("\n"),
        );
    });

    it.fails("typing above survives when a commented-out copy of the label sits below the definitions", async () => {
        const result = await popupRound({
            note: ["Text[^1] more", "", "[^1]: ", "", "%%", "[^1]: an old draft", "%%"],
            caret: { line: 0, ch: 8 },
            name: "1",
            popupText: "the definition",
            edit: (ed) => {
                ed.insertAt("Text[^1]".length, " typed");
            },
        });
        // Today: " typed" is gone.
        expect(result.text).toBe(
            ["Text[^1] typed more", "", "[^1]: the definition", "", "%%", "[^1]: an old draft", "%%"].join("\n"),
        );
    });
});

describe("U5: the popup's save-back and a definition inside a callout", () => {
    it.fails("typing BELOW a quoted definition survives (definitions in a callout above the prose)", async () => {
        // The popup opened from the reference below the callout; after
        // closing it, the user carries on typing after the reference.
        const result = await popupRound({
            note: ["> [!note] Sources", "> [^1]: ", "", "Text[^1] more"],
            caret: { line: 3, ch: 8 },
            name: "1",
            popupText: "the definition",
            edit: (ed) => {
                ed.insertAt(ed.getValue().length - " more".length, " typed");
            },
        });
        // Today: " typed" is gone.
        expect(result.text).toBe(["> [!note] Sources", "> [^1]: the definition", "", "Text[^1] typed more"].join("\n"));
    });

    it("control: typing BELOW a column-0 definition survives (issue #55 layout)", async () => {
        const result = await popupRound({
            note: ["Intro.", "", "[^1]: ", "", "## Next", "Text[^1] more"],
            caret: { line: 5, ch: 8 },
            name: "1",
            popupText: "the definition",
            edit: (ed) => {
                ed.insertAt(ed.getValue().length - " more".length, " typed");
            },
        });
        expect(result.text).toBe(["Intro.", "", "[^1]: the definition", "", "## Next", "Text[^1] typed more"].join("\n"));
    });
});
