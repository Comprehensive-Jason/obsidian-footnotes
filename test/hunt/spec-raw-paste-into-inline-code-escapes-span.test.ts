import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// spec question: a clipboard of several lines that carries definitions,
// pasted with the caret inside inline code: should the plugin step in,
// since the editor's own paste breaks out of the code span?
//
// What it does now: the note reads "Use `abc` here[^1].", a blank line,
// and "[^1]: mine". With the caret inside "`abc`" the user pastes "x[^1]",
// a blank line, and "[^1]: theirs". The plugin sees the text land in
// inline code (protected text: code, math, or a comment, where footnote
// syntax is plain text) and leaves the paste to the editor. The editor
// pastes it as it is, and the blank line in it ends the code span's
// paragraph, so "[^1]: theirs" becomes a live definition: the note now
// defines [^1] twice, and Obsidian shows "mine" only.
// What a user might expect: the README's promise that "the pasted
// footnotes come out unique": either the plugin lands the paste with the
// pasted [^1] renamed, or nothing in the note ends up defining [^1] twice.
// Why it is a question and not a bug: leaving a paste into inline code to
// the editor is on purpose (d38781d checked that these inline cases are
// left to the editor exactly as on ea38e82): footnote syntax typed into
// code is plain text, and the plugin does not second-guess it. Here the
// paste itself takes the text out of the code span, which that choice did
// not weigh.
//
// Hunt 2026-10-06, cycle 4, lens carry. Cluster K7.
//
// Origin: pre-existing.
//
// Source of truth: the README's Paste paragraph ("so the pasted
// footnotes come out unique with no setup"); d38781d's commit message.

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
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
const settings = { carryFootnotesOnCopy: true, enableRemoveBlankLastLines: true, enableFootnoteSectionHeading: false, footnoteSectionHeading: "# Footnotes", removeEmptySectionHeading: false, lintOnFootnoteCreation: false };
type Pos = { line: number; ch: number };

/** Pastes `clip` into a note holding `lines` with the caret at `at`; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], at: Pos, clip: string) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(settings, doc), event as never, doc);
    return { lines: doc.lines.slice(), taken: event.defaultPrevented };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("spec question: a carried paste into inline code that breaks out of the code span", () => {
    it.fails("the editor's raw paste is not the outcome: pasted definitions come out unique", () => {
        const note = ["Use `abc` here[^1].", "", "[^1]: mine"];
        const clip = ["x[^1]", "", "[^1]: theirs"].join("\n");
        const back = paste(note, { line: 0, ch: 8 }, clip);
        // When the plugin leaves the paste alone, the fake editor changes
        // nothing, so the note the editor's own paste gives is built here:
        // the clipboard written in at the caret, as it is.
        const after = back.taken ? back.lines : [...("Use `abc" + clip + "` here[^1].").split("\n"), "", "[^1]: mine"];
        // Today the plugin leaves it to the editor, and that note defines [^1] twice.
        const defs = readNote(after).definitions.filter((d) => d.name.toLowerCase() === "1");
        expect(defs.length).toBe(1);
    });
});
