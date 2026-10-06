import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (data loss): a press with the caret at the start of a "%%" line that
// opens a block comment writes the reference in front of the "%%", and the
// comment comes undone.
//
// A "block comment" is Obsidian's own comment over several lines: a line
// that starts with "%%" opens it, the next "%%" closes it, and Reading view
// hides everything in between. An "inline comment" is the same thing inside
// one line, "a %%hidden%% b".
//
// What the user would see: in a note with "%%", "hidden prose",
// "[^9]: hidden definition", "%%", and then "[^1]: one" further down, a
// numbered press at column 0 of the first "%%" writes "[^10]%%". That line
// no longer opens a comment, so the hidden prose shows. The old closing
// "%%" now opens a new comment instead, which hides everything after it to
// the end of the note, [^1]'s definition included. Reading view shows
// [^1] as a footnote with no definition, and a lint with Delete orphaned
// references on then deletes the reference from the text. The same
// happens after the indentation of "  %%", after "> " of a quoted "> %%",
// between the two "%" of the opener, with the named and inline keys, and
// with one caret of a multi-caret press. A press between the two "%" of an
// inline comment's opener or closer splits it the same way, and the
// comment is gone. A fenced code block, a "$$" math block, and an HTML
// comment in the same spot are refused with the protected-text notice.
//
// The press picking its number from the labels inside the comment
// ("[^10]" above, with [^9] hidden) is not part of this bug: references
// and labels in "%%" comments count on purpose (ruling A1, 2026-09-09).
//
// Hunt 2026-10-06, cycle 5, lens press. Cluster X1.
//
// Origin: pre-existing.
//
// Source of truth: docs/obsidian-reading-rules.md F1 (a line opens a block
// comment only when its text starts with "%%", so "[^1]%%" opens nothing)
// and F2 (the first "%%" on a later line closes it; without a closer the
// comment runs to the end); README ("Nor are they written into a line's
// formatting ..., where they would break the line"); the press's own
// refusal of the same spot on a fence, "$$", or "<!--" opener. Property
// seeds 161803398 and 141421356 of test/command-properties.test.ts shrink
// to this.
//
// Cause: since ruling A1 the masked twin (the copy of the note with
// protected text blanked out) keeps "%%" comment text as written, and the
// "%%" lines are not protected lines, so none of the press guards in
// src/commands/press-guards.ts sees a comment opener at the caret. The
// check after the press (src/editor/insertion-liveness.ts) asks whether
// the new reference is live, not whether the lines around it still read as
// they did.

beforeEach(resetNotices);

const Settings = {
    insertAtEndOfWord: false,
    expandSelectionToWholeWords: true,
    footnotePlacement: "after" as const,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

/** Whether the line reading `text` sits inside a "%%" comment. */
function commented(lines: string[], text: string): boolean {
    const i = lines.indexOf(text);
    return readNote(lines).commentLines[i] ?? false;
}

describe("a press at a '%%' block comment's opener undoes the comment", () => {
    // Now: "Text[^1] here", "", "[^10]%%", "hidden prose",
    // "[^9]: hidden definition", "", "[^10]: ", "", "%%", "", "[^1]: one":
    // the last "%%" opens a comment that hides [^1]'s definition.
    it.fails("[^1]'s definition is still a definition after the press", async () => {
        const lines = ["Text[^1] here", "", "%%", "hidden prose", "[^9]: hidden definition", "%%", "", "[^1]: one"];
        const doc = fakeEditor(lines, { cursor: { line: 2, ch: 0 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(readNote(doc.lines).definitions.map((d) => d.name), JSON.stringify(doc.lines)).toContain("1");
    });

    // Now: "text", "", "[^1]%%", "hidden draft", "", "[^1]: ", "", "%%",
    // "", "shown after": "hidden draft" shows and "shown after" is hidden.
    it.fails('autonum: ch 0 of "%%" leaves the comment as it was (or refuses)', async () => {
        const lines = ["text", "", "%%", "hidden draft", "%%", "", "shown after"];
        const doc = fakeEditor(lines, { cursor: { line: 2, ch: 0 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(commented(doc.lines, "shown after"), JSON.stringify({ lines: doc.lines, notices: messages() })).toBe(false);
        expect(commented(doc.lines, "hidden draft"), JSON.stringify(doc.lines)).toBe(true);
    });
});

describe("a press between the two '%' of an inline comment's mark splits the comment", () => {
    // Now: "a %[^1]%hidden%% b": no comment left, "hidden" shows.
    it.fails('autonum: between the two "%" of the opener refuses or keeps the comment', async () => {
        const lines = ["a %%hidden%% b"];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 3 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(readNote(doc.lines).comments.length, JSON.stringify({ lines: doc.lines, notices: messages() })).toBe(1);
    });

    // Now: "a %%hidden%[^1]% b": no comment left.
    it.fails('autonum: between the two "%" of the closer refuses or keeps the comment', async () => {
        const lines = ["a %%hidden%% b"];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 11 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(readNote(doc.lines).comments.length, JSON.stringify({ lines: doc.lines, notices: messages() })).toBe(1);
    });
});
