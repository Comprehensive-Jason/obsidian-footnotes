import { afterEach, describe, expect, it, vi } from "vitest";

import FootnotePlugin from "../../src/main";
import { installCarryFootnoteHooks } from "../../src/commands/carry-footnotes-hooks";

// spec question: should copy and cut carry footnotes in a note popped out
// into its own window?
//
// What it does now: the copy and cut hooks are registered on the main
// window's page only. A popped-out window has a page of its own, and its
// copy and cut events never reach the hooks, so there a copy takes the
// references without their definitions, and a cut leaves the definitions
// behind with nothing pointing at them, silently. The paste hook is an
// Obsidian workspace event and does hear popped-out windows.
// What a user might expect: a popped-out note is still Obsidian, so
// copy and cut work there as they do in the main window.
// Why it is a question and not a bug: the README scopes the feature to
// "within one Obsidian window", and a popped-out window is literally
// another window. Whether that phrase was meant to exclude popouts, or
// only another vault's window, is Jason's call. Obsidian's own pop-out
// guidance is to register per window through the workspace "window-open"
// event, and the repo already cares about the editor's own window
// elsewhere (E37: timers come from the editor's own window).
//
// Hunt 2026-10-02, round 3, lens carry-terrain. Cluster T4.
//
// Source of truth: README, "Copying, cutting, and pasting footnotes":
// "it hooks the keys you already press, within one Obsidian window".

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("spec question: copy and cut in a popped-out window", () => {
    it.fails("copy and cut in a popout window reach the hooks", () => {
        // the main window's page, so installing the hooks has somewhere to register
        const mainDoc = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
        vi.stubGlobal("document", mainDoc);
        // every page listener the plugin registers, and every workspace event it subscribes to
        const registered: { target: unknown; type: string }[] = [];
        const workspaceHandlers = new Map<string, ((...args: unknown[]) => void)[]>();
        const plugin = {
            settings: { carryFootnotesOnCopy: true },
            registerDomEvent: (target: unknown, type: string) => registered.push({ target, type }),
            registerEvent: () => {},
            registerEditorExtension: () => {},
            app: {
                workspace: {
                    on: (name: string, cb: (...args: unknown[]) => void) => {
                        workspaceHandlers.set(name, [...(workspaceHandlers.get(name) ?? []), cb]);
                        return {};
                    },
                    getLeavesOfType: () => [],
                },
            },
        } as unknown as FootnotePlugin;
        installCarryFootnoteHooks(plugin);
        // a window is popped out: Obsidian fires "window-open" with it
        const popDoc = {
            addEventListener: (type: string) => registered.push({ target: popDoc, type }),
            removeEventListener: () => {},
        };
        const popWin = { document: popDoc, win: { document: popDoc }, doc: popDoc };
        for (const cb of workspaceHandlers.get("window-open") ?? []) cb(popWin, popWin.win);
        const onPopout = registered.filter((r) => r.target === popDoc).map((r) => r.type);
        // Today: nothing is registered on the popped-out window's page
        expect(onPopout).toEqual(expect.arrayContaining(["copy", "cut"]));
    });
});
