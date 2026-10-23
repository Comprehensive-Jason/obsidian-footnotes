import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { messages, noticed, resetNotices } from "../helpers/notices";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { ProtectedSelectionNotice } from "../../src/commands/selection-footnote";
import { ProtectedCreationNotice } from "../helpers/toasts";

// BUG (cosmetic): a selection that grabs one "%%" comment delimiter
// without its partner is refused, correctly and with the note untouched,
// but the toast is the wrong one. It says the CARET message, "No footnote
// was created: footnotes can't go inside code, math, or other protected
// text", when the selection message is the one that fits: "No footnote was
// created: the selection cuts through code, math, or other protected text.
// Select all of it or none of it."
//
// What the user would see: they drag from a "%%" closer down over the line
// below it (or from the line above down over the "%%" opener), press the
// hotkey, and are told their CARET is inside protected text. It is not.
// The message they need is the one that tells them to take all of the
// comment or none of it, which is the fix for what they actually did.
//
// Hunt: 2026-09-13. Lens: selection conversion, protected text.
//
// Source of truth: the comment above ProtectedSelectionNotice in
// selection-footnote.ts: "This message is deliberately not
// ProtectedCreationNotice (Jason's manual pass, 2026-08-13). That one
// means the caret sits inside protected text. This one means a selection
// EDGE cuts through protected text."
//
// Cause: neither edge of this selection is strictly inside the comment, so
// the early selection check passes it through, and the press is caught
// later by the born-dead check, which raises the caret message.
//
// The fix is message routing, NOT masking the "%%" delimiters into the
// selection check. Masking them would treat a reference hidden inside a
// comment as dead, and a reference inside a comment is live: it binds and
// it takes a number.

function fakeEditor(
    lines: string[],
    anchor: EditorPosition,
    head: EditorPosition,
): FakeEditor {
    return sharedFakeEditor(lines, {
        cursor: anchor,
        selection: { anchor, head },
        edits: true,
        wholeDoc: true,
    });
}

function fakePlugin(doc: FakeEditor, overrides = {}): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            expandSelectionToWholeWords: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: false,
            lintOnFootnoteCreation: false,
            ...overrides,
        },
        doc,
    );
}

const LINES = [
    "above",
    "%%",
    "secret [^1] inside",
    "%%",
    "below tail",
    "",
    "[^1]: the definition",
];

beforeEach(resetNotices);

describe("a selection taking the %% closer plus the line under it", () => {
    // Green today, and the important half: the note is safe. Exactly one
    // refusal toast is shown, so only its wording is at issue.
    it("refuses with a single toast and leaves the note untouched", async () => {
        const doc = fakeEditor(LINES, { line: 3, ch: 0 }, { line: 4, ch: 10 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(messages().length).toBe(1);
    });

    it("says the selection message, not the caret one", async () => {
        const doc = fakeEditor(LINES, { line: 3, ch: 0 }, { line: 4, ch: 10 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
        expect(noticed(ProtectedCreationNotice)).toBe(false);
    });
});

describe("a selection taking the line above plus the %% opener", () => {
    it("refuses with a single toast and leaves the note untouched", async () => {
        const doc = fakeEditor(LINES, { line: 0, ch: 0 }, { line: 1, ch: 2 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(messages().length).toBe(1);
    });

    it("says the selection message, not the caret one", async () => {
        const doc = fakeEditor(LINES, { line: 0, ch: 0 }, { line: 1, ch: 2 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(ProtectedSelectionNotice)).toBe(true);
        expect(noticed(ProtectedCreationNotice)).toBe(false);
    });
});
