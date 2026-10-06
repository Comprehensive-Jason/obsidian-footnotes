import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { ProtectedCreationNotice } from "../../src/editor/insertion-liveness";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// spec question: should a press with the caret inside a "%%" comment be
// refused, as a press inside an HTML comment is?
//
// A "%%" comment is Obsidian's own comment: "a %%hidden%% b" on one line
// (inline), or a "%%" line, hidden lines, and a closing "%%" line (block).
// Reading view hides everything inside it.
//
// What it does now: the press creates the footnote inside the comment,
// with no notice. "a %%hidden%% b" with the caret after "hid" becomes
// "a %%hidden[^1]%% b" plus a "[^1]: " definition, and a caret inside a
// block comment's "hidden draft" line writes "hidden[^1] draft" there.
// Reading view hides the reference, but the definition still shows,
// numbered, in the footnotes list. A press inside an HTML comment,
// "a <!-- hidden --> b", is refused with the protected-text notice.
// What a user might expect: the README says "Footnotes are never created
// inside code, math, comments, frontmatter, ... The plugin refuses in
// those spots and tells you why." A user would expect the same refusal and
// notice inside a "%%" comment.
// Why it is a question and not a bug: since ruling A1 (2026-09-09) a
// reference inside a "%%" comment is live (Obsidian lists its footnote),
// so the footnote is not dead text the way one in code is. The README's
// "comments" may have meant HTML comments only.
//
// Options:
//   (a) refuse inside a "%%" comment with the protected-text notice, as
//       inside an HTML comment, which keeps the README's promise;
//   (b) keep creating it there, and reword the README to say which
//       comments it means.
// The tests below take option (a), the hunt's recommendation (the
// reference would be invisible in Reading view).
//
// Hunt 2026-10-06, cycle 5, lens press. Cluster X2.
//
// Origin: pre-existing.
//
// Source of truth: README (the sentence quoted above); the doc comment on
// warnProtectedCaretIfInside in src/commands/press-guards.ts (creation is
// "blocked when the caret sits inside protected text: code, math, a
// comment, or frontmatter"); ruling A1 (2026-09-09), which made "%%"
// comment text live, so the guard, which asks the masked twin, no longer
// sees it as protected.

beforeEach(resetNotices);

const Settings = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

describe('a press inside a "%%" comment', () => {
    // Now: "text", "%%", "hidden[^1] draft", "%%", "after", "", "[^1]: ",
    // with no notice.
    it.fails("autonum: inside a block comment refuses with the protected-text notice", async () => {
        const lines = ["text", "%%", "hidden draft", "%%", "after"];
        const doc = fakeEditor([...lines], { cursor: { line: 2, ch: 3 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(doc.lines, JSON.stringify(messages())).toEqual(lines);
        expect(messages()).toContain(ProtectedCreationNotice);
    });

    // Now: "a %%hidden[^1]%% b", "", "[^1]: ", with no notice.
    it.fails("autonum: inside an inline comment refuses with the protected-text notice", async () => {
        const lines = ["a %%hidden%% b"];
        const doc = fakeEditor([...lines], { cursor: { line: 0, ch: 6 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(doc.lines, JSON.stringify(messages())).toEqual(lines);
        expect(messages()).toContain(ProtectedCreationNotice);
    });

    // HTML comments are refused today, the shape the README's promise holds for.
    it("control: inside an HTML comment the press is refused", async () => {
        const lines = ["a <!-- hidden --> b"];
        const doc = fakeEditor([...lines], { cursor: { line: 0, ch: 8 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(doc.lines).toEqual(lines);
        expect(messages()).toContain(ProtectedCreationNotice);
    });
});
