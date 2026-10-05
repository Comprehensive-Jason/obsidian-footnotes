import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { ProtectedCreationNotice } from "../../src/editor/insertion-liveness";

// spec question (UI text): when a press at the start of a line that
// begins with ":" is refused, what should the toast say?
//
// What it does now: with the caret at column 0 of ":smile: done" (after
// a blank line, or alone in the note), the numbered key is refused, which
// is right: "[^1]" followed by ":" would be a definition's label, not a
// reference. But the toast is the protected-text one, which speaks of
// code, math, or a comment, and nothing on the line is any of those.
// What a user might expect: a toast that names the real cause, for
// example that a footnote cannot start a line that begins with a colon.
// Why it is a question and not a bug: the refusal itself is correct and
// nothing is written; only the wording misleads. The wording is Jason's
// call; offer drafts.
//
// Hunt 2026-10-05, round 1, lens refusals. Cluster RF6 (its notice).
//
// Source of truth: the protected-text toast's own text
// (ProtectedCreationNotice), which names code, math, and comments. The
// write that the other faces of this cluster make is pinned in
// bug-colon-line-start-label.

const Settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);

describe("a press at column 0 in front of a line-initial colon", () => {
    it.fails("the numbered key's refusal does not blame protected text", async () => {
        const lines = [":smile: done"];
        const doc = fakeEditor([...lines], { cursor: { line: 0, ch: 0 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(doc.lines).toEqual(lines);
        expect(messages()).toHaveLength(1);
        // Today: the protected-text toast.
        expect(messages()).not.toEqual([ProtectedCreationNotice]);
    });
});
