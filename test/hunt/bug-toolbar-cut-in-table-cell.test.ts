import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (data loss, modelled): on a phone, a cut from the system toolbar
// while text in a table cell is selected cuts the main editor's old
// selection instead.
//
// What the user would see: on an Android phone, the main editor still
// holds an old selection, "a[^1] b" on the first line. The user then
// selects text inside a table cell (Obsidian edits a table cell in a
// small editor of its own, drawn inside the note) and taps Cut on the
// system toolbar. The plugin cuts the first line and its definition
// instead of the cell's text.
//
// This is modelled, not seen: the test builds the phone's situation the
// way test/carry-phone-selection-toolbar.test.ts does (the toolbar fires
// the cut at the page's body, and the body holds the focus). It needs a
// check on a phone.
//
// Hunt 2026-10-05, round 1, lens carry. Cluster CA6.
//
// Source of truth: the carry's own rule that a table cell's editor is
// left alone ("as it does when a table cell's editor holds the focus",
// commit 9d66167), and test/carry-phone-selection-toolbar.test.ts, whose
// model this test reuses.
//
// Cause: eventInEditorText accepts the cut because the page's selection
// lies inside the note's text area, and the cell's editor is drawn
// inside it. nestedSubEditorOwnsFocus, the check that leaves a table
// cell's editor alone, looks only at which element holds the focus, and
// here the body does.

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("the page-selection rule and a table cell's editor (phone toolbar model)", () => {
    it("a cut from the toolbar whose selection is in a table cell does not cut the main editor's old selection", () => {
        const NOTE = ["a[^1] b", "", "| c |", "| - |", "| cell text |", "", "[^1]: one"];
        const doc = fakeEditor(NOTE, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 7 }, selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 7 } } });
        const body = { tagName: "BODY", isContentEditable: false };
        const cellText = { inCell: true };
        const contentDOM: Record<string, unknown> = {};
        Object.assign(contentDOM, {
            ownerDocument: { body, activeElement: body, getSelection: () => ({ anchorNode: cellText }) },
            // The cell's editor is drawn inside the note's text area.
            contains: (node: unknown) => node === contentDOM || node === cellText,
        });
        Object.assign(doc, { cm: { contentDOM, focus() {} }, hasFocus: () => false });
        const plugin = {
            app: { workspace: { getActiveViewOfType: () => ({ editor: doc, getMode: () => "source" }) }, vault: {} },
            settings: { carryFootnotesOnCopy: true },
        } as unknown as FootnotePlugin;
        const event = {
            target: body,
            written: {} as Record<string, string>,
            defaultPrevented: false,
            clipboardData: {
                types: ["text/plain"],
                getData: () => "",
                setData: (type: string, value: string) => {
                    event.written[type] = value;
                },
            },
            preventDefault() {
                event.defaultPrevented = true;
            },
            stopPropagation() {},
        };
        handleCut(plugin, event as never);
        // Today: line 0 and its definition are cut, and the cell's text is not.
        expect(doc.lines).toEqual(NOTE);
    });
});
