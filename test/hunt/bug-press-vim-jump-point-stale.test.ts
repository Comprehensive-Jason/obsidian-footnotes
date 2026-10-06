import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditorPosition } from "obsidian";

import type FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { resetNotices } from "../helpers/notices";

// BUG (annoyance, vim mode only): after a press whose definition is added
// ABOVE the caret, vim's Ctrl-O jumps back to the wrong line.
//
// What the user would see: vim mode is on, and the note keeps its
// definitions under a "## Notes" heading in the middle, with more prose
// below (issue #55's layout). The user presses the footnote key in that
// lower prose, writes the definition, and presses Ctrl-O to return to where
// they pressed. The caret lands one line too high, on the blank line above
// the paragraph, because the new definition pushed everything below it down
// a line.
//
// Hunt 2026-10-02, round 4, lens root causes. Cluster O4 (root 5, "caret
// positions kept from before an edit that changes lines above them").
// Round 1 (C7, C8) and round 2 (I5) pinned the carry cut and paste carets.
//
// Source of truth: cursor-motion.ts's own comment (the move is added "to
// vim's jump list", so Ctrl-O returns to where the press was) and its rule
// two lines up ("`selection` here counts against the document as it is
// AFTER the changes"); the jump-list position is used at the same moment.
// In CodeMirror's vim, jumpList.add places its bookmark with
// cm.setBookmark(oldCur) in the document as it is after the change.
//
// Severity: low. Only vim users, and only Ctrl-O after such a press.
//
// Cause: moveCursorAndSetJumpPoint applies the changes first and then hands
// vim the press position as it was BEFORE them (landDefinitionBackedInsertion
// passes `origin`, read before the edit).
//
// Fix (2026-10-06): moveCursorAndSetJumpPoint maps the old caret through
// the changes (mapPosition, text written right at it going after it)
// before handing it to vim, so every caller is covered at once.

const globalSlot = globalThis as unknown as { activeWindow?: unknown };
let hadActiveWindow = false;
let savedActiveWindow: unknown;
const vimJumps: { from: EditorPosition; to: EditorPosition }[] = [];

beforeEach(() => {
    resetNotices();
    hadActiveWindow = "activeWindow" in globalSlot;
    savedActiveWindow = globalSlot.activeWindow;
    vimJumps.length = 0;
    // A stand-in for Obsidian's vim: it records every jump the plugin adds.
    globalSlot.activeWindow = {
        CodeMirrorAdapter: {
            Vim: {
                getVimGlobalState_: () => ({
                    jumpList: {
                        add(_cm: unknown, from: EditorPosition, to: EditorPosition) {
                            vimJumps.push({ from, to });
                        },
                    },
                }),
            },
        },
    };
});
afterEach(() => {
    if (hadActiveWindow) globalSlot.activeWindow = savedActiveWindow;
    else delete globalSlot.activeWindow;
});

/** A plugin on its defaults with vim mode on, the popup off, working in `doc`. */
function vimPlugin(doc: unknown): FootnotePlugin {
    return {
        settings: { ...DEFAULT_SETTINGS, enablePopupEditor: false, insertAtEndOfWord: false },
        app: {
            workspace: { getActiveViewOfType: () => ({ editor: doc }) },
            vault: { getConfig: (key: string) => key === "vimMode" },
        },
    } as unknown as FootnotePlugin;
}

describe("the vim jump point of a press whose definition lands above the caret", () => {
    it("records the press position in the note as it is after the edit", async () => {
        const lines = ["Intro[^1] here.", "", "## Notes", "", "[^1]: one", "", "## Later", "", "More prose here."];
        const doc = fakeEditor(lines, { cursor: { line: 8, ch: 4 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(vimPlugin(doc));
        // The definition [^2] went in under [^1], above the caret.
        expect(doc.lines[5]).toBe("[^2]: ");
        expect(doc.lines[9]).toBe("More[^2] prose here.");
        expect(vimJumps).toHaveLength(1);
        // Today: line 8, the blank line above "More[^2] prose here.".
        expect(vimJumps[0].from.line).toBe(9);
    });

    it("control: a definition appended below the caret leaves the press line where it was", async () => {
        const lines = ["Intro here.", "", "[^1]: one"];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 5 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(vimPlugin(doc));
        expect(vimJumps[0].from).toEqual({ line: 0, ch: 5 });
    });
});
