import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { resetNotices } from "../helpers/notices";
import FootnotePlugin from "../../src/main";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (low): with the focus in a table cell whose own little editor the
// plugin cannot reach, a cut or a carried paste writes into the main
// editor at its old selection.
//
// What the user would see: they selected "a[^1] b" in the note earlier,
// then clicked into a table cell and pressed Ctrl+X or Ctrl+V there. The
// cut removes the earlier line and its definition from the note instead
// of the cell's text; the paste replaces that earlier line with the
// pasted text. This only happens on a fallback path: normally the plugin
// finds the cell's editor and steps aside, and the case here is the rare
// one where it cannot (the cell's editor offers no way back to itself).
// The plugin's own guard is defensive code for that case, and these
// hooks skip it.
//
// Hunt 2026-10-02, round 3, lens carry-terrain. Cluster T2.
//
// Source of truth: the docstring of nestedSubEditorOwnsFocus
// (src/editor/table-cursor.ts): editing the document while a nested
// editor holds focus races its write-back into the note, the corruption
// family from issue #28, so "Callers therefore wait, write somewhere
// else, or skip."
//
// Cause: carryableSelection and handlePaste only ask activeTableCellEditor
// whether a cell owns the focus. When the cell's editor cannot be reached
// that answer is "no", and neither of them asks nestedSubEditorOwnsFocus,
// which would have said yes.

// The note, and the selection the user left in it before clicking into
// the cell: the whole first line, reference included.
const NOTE = ["a[^1] b", "", "[^1]: one"];
const SELECTION = { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 7 } };

/** A stand-in for a page element: it answers closest() for the selectors it sits inside. */
interface FakeTarget {
    closest(selector: string): unknown;
}

/** An element inside a table cell of the note; its editor cannot be reached from it. */
function cellElement(): FakeTarget {
    return { closest: (selector: string) => (selector === "td, th" ? {} : null) };
}

/**
 * The note's editor holding the old selection, with a CodeMirror stand-in
 * whose focused element is `active`, sitting inside the editor's content.
 * The stand-in has no findFromDOM, so the cell's own editor cannot be
 * found from the focused element.
 */
function editorWithFocusIn(active: FakeTarget): FakeEditor {
    const doc = fakeEditor(NOTE, { wholeDoc: true, edits: true, cursor: SELECTION.head, selection: SELECTION });
    const contentDOM = {
        ownerDocument: { activeElement: active },
        contains: (node: unknown) => node === contentDOM || node === active,
    };
    Object.assign(doc, { cm: { contentDOM, focus() {} }, hasFocus: () => false });
    return doc;
}

/** A plugin whose active note is `doc`, in Live Preview, with `active` as the page's focused element. */
function pluginFor(doc: FakeEditor, active: FakeTarget): FootnotePlugin {
    return {
        app: {
            workspace: {
                getActiveViewOfType: () => ({
                    editor: doc,
                    getMode: () => "source",
                    containerEl: { ownerDocument: { activeElement: active } },
                }),
            },
            vault: {},
        },
        settings: { carryFootnotesOnCopy: true, enableRemoveBlankLastLines: true },
    } as unknown as FootnotePlugin;
}

/** A stand-in for the browser's clipboard event fired at `target`: it reads `text` and records what the hook writes. */
function clipboardEvent(target: FakeTarget, text = "") {
    const event = {
        target,
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (type: string) => (type === "text/plain" ? text : ""),
            setData: (type: string, value: string) => {
                event.written[type] = value;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a nested editor owns the focus but cannot be reached", () => {
    it("cut while a nested editor inside the note owns focus: no main-editor write", () => {
        const cell = cellElement();
        const doc = editorWithFocusIn(cell);
        handleCut(pluginFor(doc, cell), clipboardEvent(cell) as never);
        // Today: the note is left as [""], the old selection and its definition gone
        expect(doc.lines).toEqual(NOTE);
    });

    it("paste while a nested editor owns focus: no main-editor write at the old selection", () => {
        const cell = cellElement();
        const doc = editorWithFocusIn(cell);
        handlePaste(pluginFor(doc, cell), clipboardEvent(cell, "c[^7]\n\n[^7]: seven") as never, doc);
        // Today: ["c[^7]", "", "[^1]: one", "[^7]: seven"], the old selection replaced
        expect(doc.lines).toEqual(NOTE);
    });
});
