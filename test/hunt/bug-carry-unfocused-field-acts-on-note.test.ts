import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { resetNotices } from "../helpers/notices";
import FootnotePlugin from "../../src/main";
import { handleCopy, handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (data loss): Ctrl+X or Ctrl+C in a text field outside the note's
// editor acts on the note's old selection instead of the field.
//
// What the user would see: they select "a[^1] b" in the note, then click
// into a Properties field (or the inline title, the Ctrl+F search field,
// a modal such as the command palette, or a hover popover's editor) and
// press Ctrl+X there. The text in the field stays put. Instead the line
// they selected earlier in the note vanishes, and its definition with
// it, although they were not looking at the note. Ctrl+C in the same
// field puts the note's old selection and its definition in the
// clipboard instead of the field's text.
//
// Live-verified in the sandbox vault on the Properties widget, the inline
// title, the Ctrl+F search field, and the command palette.
//
// Needs a live check: the hover popover case. It was not tried in the
// app; the fake here only says the focus sits in a popover's own editor.
//
// Hunt 2026-10-02, round 3, lens carry-terrain. Cluster T1.
//
// Source of truth: Jason's A19 ruling (commit 316eaad, 2026-09-04): while
// the Properties widget owns focus, the main editor's caret is stale, and
// acting on it "edits prose they are not even looking at". The plugin has
// propertiesWidgetOwnsFocus for exactly that. carryableSelection's own
// docstring says it reads "the note being edited", and handleCut's says
// it replaces the editor's own cut.
//
// Cause: the copy and cut hooks listen on the whole document, so they
// hear every copy and cut in the window, whatever element it came from.
// carryableSelection then reads the selection of the active note's
// editor without asking where the keyboard focus is: it checks neither
// the event's target, nor whether the editor has focus, nor
// propertiesWidgetOwnsFocus. The cut hook runs first (it captures) and
// calls preventDefault and stopPropagation, so the field's own cut never
// happens.

// The note behind the field, and the selection the user left in it
// earlier: the whole first line, reference included.
const NOTE = ["a[^1] b", "", "[^1]: one"];
const SELECTION = { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 7 } };

/** A stand-in for a page element: it answers closest() for the selectors it sits inside. */
interface FakeTarget {
    closest(selector: string): unknown;
}

/** An element outside the editor's content; `inside` lists the selectors it sits inside. */
function element(inside: string[] = []): FakeTarget {
    return { closest: (selector: string) => (inside.includes(selector) ? {} : null) };
}

/**
 * The note's editor holding the old selection, with a CodeMirror stand-in
 * whose page's focused element is `active`, and hasFocus() saying,
 * truthfully, that the editor does not have the focus.
 */
function staleEditor(active: FakeTarget): FakeEditor {
    const doc = fakeEditor(NOTE, { wholeDoc: true, edits: true, cursor: SELECTION.head, selection: SELECTION });
    const contentDOM = {
        ownerDocument: { activeElement: active },
        contains: (node: unknown) => node === contentDOM,
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

/** A stand-in for the browser's clipboard event fired at `target`: it records what the hook writes and whether the hook took the event over. */
function clipboardEvent(target: FakeTarget) {
    const event = {
        target,
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
    return event;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("copy and cut whose focus is not in the note's editor", () => {
    it.fails("cut in a Properties field (Live Preview) leaves the note's prose alone", () => {
        const field = element([".metadata-container"]);
        const doc = staleEditor(field);
        const event = clipboardEvent(field);
        handleCut(pluginFor(doc, field), event as never);
        // Today: the note is left as [""], the line and its definition gone
        expect(doc.lines).toEqual(NOTE);
        expect(event.defaultPrevented).toBe(false);
    });

    it.fails("copy in a Properties field (Live Preview) leaves the field's own clipboard text", () => {
        const field = element([".metadata-container"]);
        const doc = staleEditor(field);
        const event = clipboardEvent(field);
        handleCopy(pluginFor(doc, field), event as never);
        // Today: the clipboard is overwritten with "a[^1] b" and its definition
        expect(event.written).toEqual({});
        expect(event.defaultPrevented).toBe(false);
    });

    it.fails("cut in a text field outside the editor (inline title, Ctrl+F search, a modal) leaves the note alone", () => {
        const field = element();
        const doc = staleEditor(field);
        const event = clipboardEvent(field);
        handleCut(pluginFor(doc, field), event as never);
        // Today: the note is left as [""]
        expect(doc.lines).toEqual(NOTE);
        expect(event.defaultPrevented).toBe(false);
    });

    it.fails("copy in a text field outside the editor does not overwrite the clipboard with the note's selection", () => {
        const field = element();
        const doc = staleEditor(field);
        const event = clipboardEvent(field);
        handleCopy(pluginFor(doc, field), event as never);
        // Today: the clipboard holds the note's text, not the field's
        expect(event.written).toEqual({});
    });

    it.fails("cut in a hover popover's editor never deletes text from the note under it", () => {
        // the popover's own editor content, outside the main editor's page area
        const popover = element([".hover-popover", ".cm-content"]);
        const doc = staleEditor(popover);
        const event = clipboardEvent(popover);
        handleCut(pluginFor(doc, popover), event as never);
        // Today: the note under the popover is left as [""]
        expect(doc.lines).toEqual(NOTE);
    });
});
