import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pasteInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { readNote } from "../../src/parsing/note-reading";

// spec question (UI text): when Insert inline footnote from clipboard is
// refused because of what is on the clipboard, should the toast say so?
//
// What it did: the clipboard holds "a ` b", and the line already has a lone
// backtick further along ("Text here and ` tick"). Wrapped as "^[a ` b]", the
// pasted backtick would pair with the line's own and turn the footnote's
// closing "]" into code. The plugin refused, and the toast said "No footnote
// was created: footnotes can't go inside code, math, or other protected
// text.", while the caret sat in plain prose.
// What a user might expect: a toast that points at the clipboard, for
// example "No footnote was created: the copied text has a backtick that
// would turn the footnote into code."
// Why it is a question and not a bug: the note is safe and the refusal is
// right; only the wording is off. The README promises that anything that
// would break the footnote "is escaped automatically", so escaping the
// backtick is a third option. Jason owns UI text; offer drafts.
//
// Answered: the third option is what the plugin does now, as the README
// promises. The backtick is escaped, the footnote lands live, and no toast
// shows. The test below was it.fails until 2026-11-05, expecting the refusal.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster PR11. Same toast family
// as round 3's G1 (bug-press-inline-guard-raw-brackets), with a different
// trigger: the clipboard's own text, not the caret's place.
//
// Source of truth: the README's Inline footnotes paragraph ("anything that
// would break the footnote (e.g. stray brackets) is escaped
// automatically") and the protected-text toast's meaning.

beforeEach(resetNotices);
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("a clipboard whose backtick would break the inline footnote", () => {
    it("a pasted backtick that would pair with a lone backtick on the line is escaped, and the footnote lands live", async () => {
        vi.stubGlobal("navigator", { clipboard: { readText: () => Promise.resolve("a ` b") } });
        const doc = fakeEditor(["Text here and ` tick", "", "After the paste."], {
            cursor: { line: 0, ch: 4 },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await pasteInlineFootnote(fakePlugin({ insertAtEndOfWord: false, enablePopupEditor: false, enableFootnotePrefix: false }, doc));
        expect(doc.lines[0]).toBe("Text^[a \\` b] here and ` tick");
        expect(readNote(doc.lines).inlineNotesOn(0)).toHaveLength(1);
        expect(messages()).toEqual([]);
    });
});
