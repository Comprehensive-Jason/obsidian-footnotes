import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carriedInputHandler, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a paste with the caret inside a code block is taken
// over, and its definitions are pulled out of the code and landed as live
// footnotes at the bottom of the note.
//
// What the user would see: they paste a snippet of Markdown, "a[^1]" and
// "[^1]: one", into a ```md code block to show it as an example. The
// "a[^1]" lands in the code block, where it is plain code, but the
// "[^1]: one" line is lifted out of the block and added at the end of the
// note as a real definition. Nothing in the note's text references it, so
// it is an orphaned definition, and the example in the code block is
// missing its second line. The same happens through a phone keyboard's
// clipboard history, and with the caret in frontmatter, a %% comment, or
// a $$ math block (cluster notes).
//
// Hunt 2026-10-02, round 1, lens carry-clip. Cluster C19.
//
// Source of truth: CONTEXT.md and the plugin-wide rule that a reference
// inside protected text (code, math, frontmatter, comments) is dead, so
// there is no footnote there to carry a definition for. Every other
// command refuses to create a footnote in protected text
// (ProtectedCreationNotice: "footnotes can't go inside code, math, or
// other protected text").
//
// Cause: handlePaste and carriedInputHandler never ask whether the caret
// sits in protected text before they split the clipboard and land the
// definitions.

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

describe("a paste with the caret inside a code fence", () => {
    // handlePaste returning false hands the paste back to the editor,
    // which drops the text in as it is. The fake editor does not do that
    // part, so the note stays as it was.
    it.fails("2e: a paste inside a code fence is literal: nothing is pulled out of the code", () => {
        const doc = editor(["```md", "", "```", "", "after"], { line: 1, ch: 0 });
        // Today the paste is taken over and the note becomes "```md",
        // "a[^1]", "```", "", "after", "", "[^1]: one".
        expect(handlePaste(fakePlugin(on, doc), clipboardEvent("a[^1]\n\n[^1]: one") as never, doc)).toBe(false);
        expect(doc.lines).toEqual(["```md", "", "```", "", "after"]);
    });

    // The phone route: a keyboard's clipboard history commits the text
    // through the input method (the system that turns key presses into
    // text) instead of firing a paste event, so carriedInputHandler sees
    // it instead of handlePaste.
    it.fails("3c: text committed inside a code fence through a phone keyboard is left to the editor", () => {
        const doc = editor(["```", "", "```"], { line: 1, ch: 0 });
        const handle = carriedInputHandler(fakePlugin(on, doc), () => doc);
        const at = doc.posToOffset({ line: 1, ch: 0 });
        expect(handle({} as never, at, at, "a[^1]\n\n[^1]: one")).toBe(false);
    });
});
