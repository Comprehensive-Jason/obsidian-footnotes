import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { resetNotices } from "../helpers/notices";
import FootnotePlugin from "../../src/main";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output, with Lint on footnote creation on): a carried paste
// into a hover popover's editor lints a different note, the one open in
// the active tab behind the popover.
//
// What the user would see: they hover a link, and in the popover's
// editor they paste text carrying a footnote. The paste lands in the
// popover's note correctly. Then the lint runs on the note in the main
// tab instead, which they did not touch: here its definition, which sits
// above its reference, is moved to the bottom.
//
// Needs a live check: that Obsidian fires its editor-paste event for a
// hover popover's editor (or a canvas card's) at all, handing the hook
// that editor rather than the active tab's.
//
// Hunt 2026-10-02, round 3, lens carry-terrain. Cluster T3.
//
// Source of truth: README, "Lint on footnote creation: lints the note
// right after you create a new footnote", which is the note the footnote
// was created in. The hooks' own header says the lint-on-creation trigger
// runs after a carried paste "as after every press that creates a
// footnote".
//
// Cause: Obsidian's editor-paste event hands handlePaste the editor the
// paste happened in, and landCarriedText lands the text there. But it
// then calls lintAfterFootnoteCreation, which lints the active tab's note
// (workspace.getActiveViewOfType(MarkdownView)), not that editor.

/** A stand-in for the browser's clipboard event: it reads `text` and records whether the hook took the event over. */
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

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("lint on creation after a carried paste", () => {
    it("lints the note the paste landed in, never the active view's other note", () => {
        // the note in the active tab behind the popover: its definition
        // sits above its reference, so Move to bottom WOULD rewrite it
        const main = fakeEditor(["[^1]: one", "", "text[^1]"], { wholeDoc: true, edits: true, cursor: { line: 2, ch: 0 } });
        const popover = fakeEditor(["p"], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 1 } });
        const plugin = {
            app: { workspace: { getActiveViewOfType: () => ({ editor: main, getMode: () => "source" }) }, vault: {} },
            settings: {
                carryFootnotesOnCopy: true,
                enableRemoveBlankLastLines: true,
                lintOnFootnoteCreation: true,
                lintMoveToBottom: true,
                lintReindex: true,
                lintFixLazyDefinitions: true,
                lintFixPunctuation: true,
                footnotePlacement: "after",
            },
        } as unknown as FootnotePlugin;
        handlePaste(plugin, clipboardEvent("c[^7]\n\n[^7]: seven") as never, popover);
        expect(popover.lines).toEqual(["pc[^7]", "", "[^7]: seven"]);
        // Today: the main note is rewritten to ["text[^1]", "", "[^1]: one"]
        expect(main.lines).toEqual(["[^1]: one", "", "text[^1]"]);
    });
});
