import { beforeEach, describe, expect, it } from "vitest";

import { insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (wrong toast): a named press inside inline code that holds "[^]]"
// complains about the footnote's name instead of saying the caret is in
// code.
//
// What the user would see: the note reads "Type `[^]]` to see." and the
// caret sits between "[^]" and "]" inside the backticks. They press the
// named-footnote key. Nothing is written, which is right, but the toast
// says "Footnote names can't contain spaces, ..." as if they had typed a
// bad name. Every other press inside inline code says "No footnote was
// created: footnotes can't go inside code, math, or other protected
// text."
//
// Hunt 2026-10-02, round 4, lens root causes. Cluster O7 (root 6, "a check
// on the raw line before the masked one"). Round 3's G1
// (bug-press-inline-guard-raw-brackets) pinned the same kind of mix-up in
// maskedInlineFootnoteSpan.
//
// Source of truth: the protected-text guard's toast, which every other
// press inside code gets; CONTEXT.md (protected text: regions where
// footnote syntax is plain text, not footnotes, such as code).
//
// Severity: low. Wording only; the note is safe.
//
// Cause: createFootnoteReference checks for "[^]]" on the raw line, before
// the protected-caret guard runs, so the invalid-name toast wins.

beforeEach(resetNotices);

describe("the '[^]]' check reads the raw line only", () => {
    it.fails("a named press between '[^]' and ']' inside inline code gets the protected-text toast", async () => {
        const text = "Type `[^]]` to see.";
        const ch = text.indexOf("[^]") + 3;
        const doc = fakeEditor([text], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
        await insertNamedFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, doc));
        expect(doc.lines).toEqual([text]);
        // Today: "Footnote names can't contain spaces, ..." (the invalid-name toast).
        expect(messages().join(" ")).toMatch(/protected|code/i);
    });
});
