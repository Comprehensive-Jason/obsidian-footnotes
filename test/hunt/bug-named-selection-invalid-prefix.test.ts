import { Modal } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { selectionPressHandled } from "../../src/commands/selection-footnote";
import { TableCellEditor } from "../../src/editor/table-cursor";

// The named key pressed with text selected, in a note whose footnote-prefix
// property is invalid (here it holds a space). The plugin showed "No
// footnote was created: this note's footnote-prefix ("bad prefix") is
// invalid. ..." and then opened the Name the footnote dialog anyway, and
// the name typed into it converted the selection: the note gained
// "[^why]" and its definition under the refusal that said nothing was
// created. Seen live on sprout's Obsidian 1.14.4 on 2026-10-22 (run
// toast-bugs): "Some words here" with "words" selected became
// "Some[^why] here" and "[^why]: words", the refusal toast still showing.
//
// Expected: the refusal stands, as it does for the numbered key with a
// selection and for both keys without one (manual-invalid-prefix-property
// tests): no dialog, nothing created. A selection inside a table cell went
// the same way, minus the toast: its named branch never asked about the
// prefix, so the dialog opened silently.
//
// Cause: the named key first asks the result gate about the selection under
// the next free number, and that number is where the prefix is checked. A
// null number (the prefix is invalid, its notice shown) skipped the gate
// question but still fell through to opening the dialog.
//
// Origin: pre-existing, red at a9acb87. Found by reading the code for the
// toast inventory of 2026-10-22 (its "odd things" item 7), confirmed live
// in run toast-bugs.

const NOTE = ["---", "footnote-prefix: bad prefix", "---", "Some words here and more."];
const REFUSAL =
    'No footnote was created: this note\'s footnote-prefix ("bad prefix") is invalid. The footnote prefix can\'t contain spaces, backticks, brackets, or "#".';

const settings = {
    insertAtEndOfWord: false,
    enablePopupEditor: false,
    enableFootnotePrefix: true,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
    expandSelectionToWholeWords: false,
};

// "words" on the note's fourth line
const selection = { anchor: { line: 3, ch: 5 }, head: { line: 3, ch: 10 } };

let opened: number;
beforeEach(() => {
    resetNotices();
    opened = 0;
    vi.spyOn(Modal.prototype, "open").mockImplementation(() => {
        opened++;
    });
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe("the named key with a selection, under an invalid prefix", () => {
    it("refuses with the prefix notice and opens no dialog", async () => {
        const doc = fakeEditor([...NOTE], { wholeDoc: true, edits: true, cursor: selection.head, selection });
        await insertNamedFootnote(fakePlugin(settings, doc));
        expect(opened).toBe(0);
        expect(messages()).toEqual([REFUSAL]);
        expect(doc.lines).toEqual(NOTE);
    });

    it("a selection inside a table cell: refused the same way", () => {
        const text = "plain word here";
        const dispatched: unknown[] = [];
        const cell: TableCellEditor = {
            state: { doc: { toString: () => text }, selection: { main: { anchor: 6, head: 10 } } },
            dispatch: (spec) => {
                dispatched.push(spec);
            },
        };
        const lines = ["---", "footnote-prefix: bad prefix", "---", "| plain word here |", "| --- |", "| x |"];
        const doc = fakeEditor([...lines], { cursor: { line: 3, ch: 8 }, wholeDoc: true, edits: true });
        expect(selectionPressHandled(fakePlugin(settings, doc), doc, cell, "named", { line: 3, ch: 8 })).toBe(true);
        expect(opened).toBe(0);
        expect(dispatched).toEqual([]);
        expect(messages()).toEqual([REFUSAL]);
        expect(doc.lines).toEqual(lines);
    });

    // controls: what already worked, and must keep working
    it("control: the numbered key with the same selection is refused the same way", async () => {
        const doc = fakeEditor([...NOTE], { wholeDoc: true, edits: true, cursor: selection.head, selection });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        expect(messages()).toEqual([REFUSAL]);
        expect(doc.lines).toEqual(NOTE);
    });

    it("control: with the prefix feature off, the dialog opens as usual", async () => {
        const doc = fakeEditor([...NOTE], { wholeDoc: true, edits: true, cursor: selection.head, selection });
        await insertNamedFootnote(fakePlugin({ ...settings, enableFootnotePrefix: false }, doc));
        expect(opened).toBe(1);
        expect(messages()).toEqual([]);
    });

    it("control: a valid prefix opens the dialog as usual", async () => {
        const lines = ["---", "footnote-prefix: ch-", "---", "Some words here and more."];
        const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: selection.head, selection });
        await insertNamedFootnote(fakePlugin(settings, doc));
        expect(opened).toBe(1);
        expect(messages()).toEqual([]);
    });
});
