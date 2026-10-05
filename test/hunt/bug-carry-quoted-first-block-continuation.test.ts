import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a carried definition that sat inside a blockquote
// loses the second half of its text on paste, when it is the first
// definition carried.
//
// What the user would see: their source note has a definition inside a
// blockquote, "> [^q]: quoted def" with its continuation line "> more".
// They copy the text that cites [^q] and paste it into another note. The
// definition lands as "[^q]: quoted def" with the quote taken off, but
// the line under it stays "> more". Obsidian reads that as a separate
// blockquote, so "more" drops out of the footnote and shows up as a stray
// quote at the end of the note.
//
// Hunt 2026-10-02, round 1, lens carry-hook. Cluster C9.
//
// Source of truth: the README's Copy and Paste paragraphs: copy puts "the
// definitions its footnotes need into the clipboard text", and paste
// "lands the text and the definitions". A definition that arrives in two
// pieces has not landed whole. The probe accepts any of three whole
// shapes: kept quoted, or unquoted with the continuation unquoted (or
// indented) too.
//
// Cause: blockBody, which hands the first carried block's text to
// seedDefinitionBody, strips everything up to "]:" from the label line,
// which takes the "> " with it, but copies the continuation lines as they
// are, "> " included. The second and later carried blocks are spliced in
// whole and stay quoted, so the two paths disagree.

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

describe("copy text whose definition is quoted and runs over two lines, then paste it", () => {
    it("keeps a quoted definition's quoted continuation inside the definition", () => {
        const source = editor(["Text[^q] here", "", "> [^q]: quoted def", "> more"], { line: 0, ch: 0 }, { line: 0, ch: 13 });
        const copy = clipboardEvent();
        handleCopy(fakePlugin(on, source), copy as never);
        const dest = editor(["p"], { line: 0, ch: 1 });
        handlePaste(fakePlugin(on, dest), clipboardEvent(copy.written["text/plain"]) as never, dest);
        // Today the lines below the body are "", "[^q]: quoted def",
        // "> more": an unquoted label with a blockquote under it.
        const landed = dest.lines.slice(1).join("\n");
        expect(
            landed === "\n> [^q]: quoted def\n> more" || landed === "\n[^q]: quoted def\nmore" || landed === "\n[^q]: quoted def\n    more",
        ).toBe(true);
    });
});
