import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import FootnotePlugin from "../src/main";
import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";
import {
    PartOfListNotice,
    PartOfQuoteNotice,
    ProtectedSelectionNotice,
    SelectionFormattingNotice,
    TableSelectionNotice,
} from "../src/commands/selection-footnote";
import { lintBlockedByPrefix } from "../src/linting/linter";
import { fakeEditor, FakeEditor } from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

// The refusal texts built from the shared vocabulary (Jason's choice,
// 2026-10-22, run toast-consolidate: one opener, one shared reason, and
// advice where it helps). Each expectation is written out in full, so the
// test compares the words a user reads, not the pieces that build them.
// The texts most tests reach through test/helpers/toasts.ts are pinned
// there; these are the ones that had no literal pin: the selection
// refusals, the table-edge refusals, and the plural opener a press with
// several cursors now gets from every guard.

function plugin(doc: FakeEditor, settings: Partial<FootnotePlugin["settings"]> = {}): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            lintOnFootnoteCreation: false,
            ...settings,
        },
        doc,
    );
}

/** The numbered key pressed at `carets` in a note holding `lines`; the toasts it raised. */
async function press(lines: string[], carets: EditorPosition[], settings: Partial<FootnotePlugin["settings"]> = {}): Promise<string[]> {
    const doc = fakeEditor(lines, { carets, cursor: carets[0], edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(plugin(doc, settings));
    return messages();
}

const TABLE = ["Some text.", "", "| a | b |", "| --- | --- |", "| c | d |"];

beforeEach(() => {
    resetNotices();
});

describe("the selection refusals", () => {
    it("protected text: its own reason, then the selection's advice", () => {
        expect(ProtectedSelectionNotice).toBe(
            "No footnote was created: the selection cuts through code, math, or other protected text. Select all of it or none of it.",
        );
    });
    it("a selection running partway into a code span shows it", async () => {
        const lines = ["some `code span` here"];
        const selection = { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 8 } };
        const doc = fakeEditor(lines, { cursor: selection.head, selection, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(plugin(doc));
        expect(messages()).toEqual(["No footnote was created: the selection cuts through code, math, or other protected text. Select all of it or none of it."]);
    });
    it("control: a press with no selection inside the code span keeps the caret's text", async () => {
        expect(await press(["some `code span` here"], [{ line: 0, ch: 8 }])).toEqual([
            "No footnote was created: footnotes can't go inside code, math, or other protected text.",
        ]);
    });
    it("a table cut in pieces keeps its own reason", () => {
        expect(TableSelectionNotice).toBe(
            "No footnote was created: the selection cuts through a table. Select text inside one cell, or the whole table with the text around it.",
        );
    });
    it("a line's formatting, part of a list, part of a quote: the shared formatting reason with three pieces of advice", () => {
        expect([SelectionFormattingNotice, PartOfListNotice, PartOfQuoteNotice]).toEqual([
            "No footnote was created: it would break the line's formatting. Select the whole line, or only its text.",
            "No footnote was created: it would break the line's formatting. Select one item's text, or the whole list.",
            "No footnote was created: it would break the line's formatting. Select one line's text, or the whole quote.",
        ]);
    });
});

describe("the table-edge refusals say 'cursor'", () => {
    it("one cursor before a row's first pipe", async () => {
        expect(await press(TABLE, [{ line: 2, ch: 0 }])).toEqual([
            "No footnote was created: the cursor is at the edge of a table row, outside its cells. Put it inside a cell.",
        ]);
    });
    it("one cursor on the row of dashes", async () => {
        expect(await press(TABLE, [{ line: 3, ch: 4 }])).toEqual([
            "No footnote was created: the cursor is on the row of dashes under a table's header. Put it inside a cell.",
        ]);
    });
});

describe("a press with several cursors opens in the plural, whichever guard refuses it", () => {
    it("one of them at a table row's edge", async () => {
        expect(await press(TABLE, [{ line: 0, ch: 4 }, { line: 2, ch: 0 }])).toEqual([
            "No footnotes were created: a cursor is at the edge of a table row, outside its cells. Put it inside a cell.",
        ]);
    });
    it("one of them on the row of dashes", async () => {
        expect(await press(TABLE, [{ line: 0, ch: 4 }, { line: 3, ch: 4 }])).toEqual([
            "No footnotes were created: a cursor is on the row of dashes under a table's header. Put it inside a cell.",
        ]);
    });
    it("one of them in front of a list marker", async () => {
        expect(await press(["Some text.", "", "- item"], [{ line: 0, ch: 4 }, { line: 2, ch: 0 }])).toEqual([
            "No footnotes were created: it would break the line's formatting. Move the cursors into the text.",
        ]);
    });
    it("under an invalid footnote-prefix", async () => {
        const note = ["---", "footnote-prefix: bad prefix", "---", "alpha bravo"];
        expect(await press(note, [{ line: 3, ch: 5 }, { line: 3, ch: 11 }], { enableFootnotePrefix: true })).toEqual([
            `No footnotes were created: this note's footnote-prefix ("bad prefix") is invalid. The footnote prefix can't contain spaces, backticks, brackets, or "#".`,
        ]);
    });
    it("control: one cursor under the same prefix keeps the singular", async () => {
        const note = ["---", "footnote-prefix: bad prefix", "---", "alpha bravo"];
        expect(await press(note, [{ line: 3, ch: 5 }], { enableFootnotePrefix: true })).toEqual([
            `No footnote was created: this note's footnote-prefix ("bad prefix") is invalid. The footnote prefix can't contain spaces, backticks, brackets, or "#".`,
        ]);
    });
});

describe("the lint's own refusal", () => {
    it("an invalid prefix cancels it with the shared prefix reason", () => {
        expect(lintBlockedByPrefix(["---", "footnote-prefix: 10", "---", "text"].join("\n"))).toBe(
            `Linting canceled: this note's footnote-prefix ("10") is invalid. The footnote prefix can't end in a number. Its footnotes would be indistinguishable from plain numbered ones.`,
        );
    });
});
