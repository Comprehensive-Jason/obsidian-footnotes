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

// Bug (suspected; the mechanism is shown here, a live check is still to come): the popup
// teardown schedules every wait on the POPUP'S OWN window
// (`win.setTimeout`, footnote-popup.ts:676 and :741). When that window is
// gone - a note popped out into its own window that the user closes while
// the popup is open and its embed's save is in flight - its timers never
// fire, and nothing else resolves the teardown: the loops are capped by
// ITERATIONS (attempts++ < 160), not by wall time, and the one
// `await pause(...)` that never returns hangs `pendingTeardown` for good.
//
// Every later footnote command then awaits settleFootnotePopupWithFeedback
// for ever, behind a "Saving the previous footnote…" toast that is shown
// with duration 0 and never hides. The commands are dead until the plugin
// is reloaded.
//
// The model here: `win.setTimeout` is a function that returns but NEVER
// fires its callback, which is what a closed window's event loop does to a
// timer scheduled on it. The probe shows the code has no safety net for
// that: settleFootnotePopupWithFeedback is still unresolved seconds after
// the close, and footnotePopupBusy() is still true, so the commands and
// the automatic lint triggers all stay blocked.
//
// Contrast: write-back.ts restoreOtherPatches deliberately runs its
// cross-window timers on the app's OWN `window` (line 308/314/316), for
// exactly this class of reason. The popup teardown is the one place that
// uses the popup's window instead.
//
// Found by the GLM 5.3 review (2026-11-11); Jason chose to fix it. The fake
// window says it is closed (closed: true), as a real one does, and its
// embed's save finishes.

const g = globalThis as unknown as Record<string, unknown>;
let hadMO = false;
beforeAll(() => {
    if (!("window" in g)) g.window = globalThis;
    if (!("MutationObserver" in g)) {
        hadMO = true;
        g.MutationObserver = class {
            observe() {}
            disconnect() {}
        };
    }
});
afterAll(() => {
    dismissFootnotePopup();
    if (hadMO) delete g.MutationObserver;
});

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

describe("the popup teardown when its own window's timers never fire", () => {
    it("settleFootnotePopupWithFeedback does not hang for ever behind a dead window's timer", async () => {
        const editor = {
            getValue: () => "Text[^1] more\n\n[^1]: ",
            setValue() {},
            getLine: (n: number) => "Text[^1] more\n\n[^1]: ".split("\n")[n],
            lineCount: () => 3,
            lastLine: () => 2,
            getCursor: (): EditorPosition => ({ line: 0, ch: 8 }),
            setCursor() {},
            listSelections: () => [{ anchor: { line: 0, ch: 8 }, head: { line: 0, ch: 8 } }],
            focus() {},
            posToOffset: () => 0,
            offsetToPos: (): EditorPosition => ({ line: 0, ch: 0 }),
            getScrollInfo: () => ({ top: 0, left: 0 }),
            transaction() {},
        };
        let savingLooks = 0;
        // the popped-out window is gone: its timers never fire, and it
        // says it is closed, as a closed window does
        const deadWin = {
            closed: true,
            setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
            clearTimeout() {},
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
            defaultView: deadWin,
            activeElement: null,
            addEventListener() {},
            removeEventListener() {},
        };
        const app = {
            workspace: {
                getActiveViewOfType: () => mdView,
                on: () => ({}),
                offref() {},
                getLeavesOfType: () => [],
            },
            keymap: { pushScope() {}, popScope() {} },
            scope: {},
            vault: { cachedRead: () => Promise.resolve("Text[^1] more\n\n[^1]: ") },
            metadataCache: { on: () => ({}), offref() {} },
            embedRegistry: {
                embedByExtension: {
                    md: () => {
                        const embed = {
                        popupText: "the definition",
                        dirty: true,
                        // the embed's own save is in flight when the window
                        // closes, and lands after the teardown's first look
                        get saving() {
                            return savingLooks++ === 0;
                        },
                        saveAgain: false,
                        subpathNotFound: false,
                        data: "",
                        before: "Text[^1] more\n\n[^1]: ",
                        after: "",
                        editable: false,
                        load() {},
                        unload() {},
                        showEditor() {},
                        requestSave: { cancel() {} },
                        requestSaveFolds: { cancel() {} },
                        editMode: {
                            editor: {
                                focus() {},
                                getValue: () => "the definition",
                                lastLine: () => 0,
                                getLine: () => "the definition",
                                setCursor() {},
                            },
                        },
                        loadFile: () => Promise.resolve(),
                        save: () => {
                            // a save writes the text, so nothing is left unsaved
                            embed.dirty = false;
                            return Promise.resolve();
                        },
                    };
                        return embed;
                    },
                },
            },
        };
        const mdView = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
            app,
            file: { path: "note.md" },
            editor,
            containerEl: { ownerDocument: doc, contains: () => false },
            get data() {
                return "Text[^1] more\n\n[^1]: ";
            },
            save: () => Promise.resolve(),
            getMode: () => "source",
        });
        const plugin = { app, settings: { enablePopupEditor: true } } as unknown as FootnotePlugin;

        await openFootnotePopup(plugin, "1");
        for (let i = 0; i < 20; i++) await Promise.resolve();
        // the user closes the popup with the hotkey; the teardown's waits
        // are scheduled on the window that no longer runs
        expect(toggleCloseFootnotePopup()).toBe(true);
        for (let i = 0; i < 10; i++) await Promise.resolve();

        // however long the user waits, the settle must finish (it is the
        // only gate every footnote command passes through). Race it
        // against a 500 ms timer on the MAIN window, which is alive.
        const settled = await Promise.race([
            settleFootnotePopupWithFeedback().then(() => true, () => true),
            new Promise<boolean>((resolve) => window.setTimeout(() => {
                resolve(false);
            }, 3000)),
        ]);
        // Today: false - the settle never finishes; the press that awaits
        // it never runs, and the "Saving the previous footnote…" toast
        // (duration 0) never hides.
        expect(settled).toBe(true);
    }, 10000);
});
