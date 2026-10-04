import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { selectionPressHandled } from "../../src/commands/selection-footnote";
import { docContext } from "../../src/editor/doc-context";
import { NestedFootnoteNotice } from "../../src/editor/notice";
import { TableCellEditor } from "../../src/editor/table-cursor";

// BUG: converting a selection that holds a LAZY label nests a live
// reference inside the new footnote's body, which the plugin forbids
// everywhere else.
//
// A lazy label is a "[^x]:" line sitting directly under a paragraph line.
// Obsidian reads it as ordinary paragraph text, so its own "[^x]" is a
// LIVE reference, not a label (the prose-label rule, 2026-09-09).
//
// What the user would see: with
//   A paragraph of prose.
//   [^x]: lazy label body
// selecting the second line and pressing the numbered hotkey silently
// produces
//   [^1]: [^x]: lazy label body
// so "[^x]" is now a reference inside another footnote's body. Selecting
// the paragraph line THROUGH the lazy label does the same, leaving a
// label-shaped continuation line inside the body. Both should have been
// refused with the nesting toast, exactly as selecting an ordinary
// reference is.
//
// The same hole shows in a table cell: a cell whose whole text is
// "[^x]: y" converts, because the cell text's leading "[^x]" is read as a
// label. A definition cannot live in a table cell at all, so that "[^x]"
// is always a plain reference.
//
// Hunt: 2026-09-13. Lens: selection conversion.
//
// Source of truth:
//  - docs/adr/0001-no-nested-footnotes.md: "A selection that contains or
//    cuts through any live reference, placeholder, or inline footnote
//    refuses to convert, with a toast."
//  - manual sheet 14: a lazy label's own "[^p1]" is a live reference.
//  - manual sheet 04: the selection refusal list.
//  - for the cell: GFM says a table row holds inline content only, so no
//    cell text can be a definition.
//
// Cause: spanTouchesFootnote calls referenceOccurrences without passing a
// labelIsDefinition value, so it takes the default (true) and a
// line-leading "[^x]" is filtered out as a label wherever it appears.
//
// Not a precedent: test/hunt/bug-seeded-body-contains-own-label (the A4
// pin) converts a label-shaped string that sits inside a CODE SPAN. That
// string is a fake, and fakes travel freely. Nothing here is a fake.

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

function fakeCellEditor(lines: string[], ch: number): FakeEditor {
    return sharedFakeEditor(lines, { cursor: { line: 0, ch }, edits: true, wholeDoc: true });
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

/** a cell sub-editor holding `text`, with `anchor`..`head` selected */
function fakeCell(text: string, anchor: number, head: number) {
    const dispatched: {
        changes?: { from: number; to?: number; insert: string };
        selection?: { anchor: number };
    }[] = [];
    const cell: TableCellEditor = {
        state: {
            doc: { toString: () => text },
            selection: { main: { head, anchor } },
        },
        dispatch: (spec) => {
            dispatched.push(spec);
        },
    };
    return { cell, dispatched };
}

const LINES = [
    "A paragraph of prose.",
    "[^x]: lazy label body",
    "",
    "Tail prose that mentions the footnote[^x] properly.",
    "",
    "[^x]: the real definition",
];

beforeEach(resetNotices);

describe("a selection holding a lazy label", () => {
    // The premise, green today: the second line is NOT a definition start,
    // while the real definition further down is.
    it("the premise: the lazy label line is not a definition start", () => {
        const doc = fakeEditor(LINES, { line: 0, ch: 0 }, { line: 0, ch: 1 });
        expect(docContext(doc).reading().labelLines[1]).toBe(false);
        expect(docContext(doc).reading().labelLines[5]).toBe(true);
    });

    it("selecting the lazy label line refuses instead of nesting its reference", async () => {
        const doc = fakeEditor(LINES, { line: 1, ch: 0 }, { line: 1, ch: LINES[1].length });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });

    it("selecting the paragraph line through the lazy label refuses too", async () => {
        const doc = fakeEditor(LINES, { line: 0, ch: 0 }, { line: 1, ch: LINES[1].length });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });
});

describe("a table cell whose whole text is label-shaped", () => {
    const cellLines = ["| [^x]: y | b |", "| --- | --- |", "| 1 | 2 |"];

    it("selecting the whole cell refuses instead of nesting its reference", () => {
        const { cell, dispatched } = fakeCell("[^x]: y", 0, "[^x]: y".length);
        const doc = fakeCellEditor(cellLines, 3);
        const handled = selectionPressHandled(fakePlugin(doc), doc, cell, "autonum", {
            line: 0,
            ch: 3,
        });
        expect(handled).toBe(true);
        expect(dispatched).toEqual([]);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });

    // The control: the same reference one word further into the cell IS
    // caught today, which is what makes the position dependence the bug.
    it("a reference that is not at the cell's start is caught (control)", () => {
        const { cell, dispatched } = fakeCell("see [^x]: y", 0, "see [^x]: y".length);
        const doc = fakeCellEditor(["| see [^x]: y | b |", "| --- | --- |", "| 1 | 2 |"], 3);
        selectionPressHandled(fakePlugin(doc), doc, cell, "autonum", { line: 0, ch: 3 });
        expect(dispatched).toEqual([]);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });
});
