import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "./helpers/fake-editor";
import { resetNotices } from "./helpers/notices";
import FootnotePlugin from "../src/main";
import { handleCopy, handleCut, resetCarryRegister } from "../src/commands/carry-footnotes-hooks";

// Jason's report (2026-10-04, 0.3.0-beta.3 on his phone): copying, cutting,
// and pasting no longer carry footnote definitions on the phone. They did
// in 0.3.0-beta.2.
//
// What changed in between: since the 2026-10-02 hunt (cluster T1), copy,
// cut, and the carried paste act only when the clipboard event was fired
// at the note's own text, so that a cut in the search box or the note's
// title stops cutting the note's old selection instead.
//
// Why the phone falls outside that: on a phone the copy and cut come from
// Android's selection toolbar, and the browser engine fires the event at
// the page's body, not at the selected text, when the selection does not
// count as shown at that moment (Chromium sends a menu's clipboard event
// to the body while the selection is hidden; the toolbar tap takes it).
// The page's selection itself still sits in the note's text, and that
// selection is what a copy copies.
//
// A modelled case, not one seen on the phone: the event's target on the
// device is inferred from how Chromium picks it, so Jason's phone pass on
// the next beta is the real check. (Characterization of the fix's rule,
// flagged as such for Jason's review.)

const NOTE = ["a[^1] b", "", "[^1]: one"];
const SELECTION = { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 7 } };

/** A stand-in for a page element, as the hooks see one. */
interface FakeElement {
    tagName: string;
    isContentEditable: boolean;
}

/** The note's editor with its selection, and a CodeMirror stand-in on a page whose body is `body` and whose own selection starts at `selectionAnchor`. */
function phoneEditor(body: FakeElement, selectionAnchor: unknown): { doc: FakeEditor; contentDOM: unknown } {
    const doc = fakeEditor(NOTE, { wholeDoc: true, edits: true, cursor: SELECTION.head, selection: SELECTION });
    const contentDOM = {
        ownerDocument: {
            body,
            activeElement: body,
            getSelection: () => ({ anchorNode: selectionAnchor }),
        },
        contains: (node: unknown) => node === contentDOM,
    };
    Object.assign(doc, { cm: { contentDOM, focus() {} }, hasFocus: () => false });
    return { doc, contentDOM };
}

/** A plugin whose active note is `doc`, in Live Preview. */
function pluginFor(doc: FakeEditor, active: unknown): FootnotePlugin {
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

/** A clipboard event fired at `target`, recording what the hook writes and whether it took the event over. */
function clipboardEvent(target: unknown) {
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

const BODY: FakeElement = { tagName: "BODY", isContentEditable: false };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("copy and cut from the phone's selection toolbar, fired at the page body", () => {
    it("copy carries the definition when the page's selection sits in the note's text", () => {
        const page = phoneEditor(BODY, null);
        const { doc } = page;
        // the page's selection starts inside the note's text
        Object.assign((page.contentDOM as { ownerDocument: object }).ownerDocument, { getSelection: () => ({ anchorNode: page.contentDOM }) });
        const event = clipboardEvent(BODY);
        handleCopy(pluginFor(doc, BODY), event as never);
        expect(event.defaultPrevented).toBe(true);
        expect(event.written["text/plain"]).toContain("[^1]: one");
    });

    it("cut takes the definition along when the page's selection sits in the note's text", () => {
        const page = phoneEditor(BODY, null);
        const { doc } = page;
        Object.assign((page.contentDOM as { ownerDocument: object }).ownerDocument, { getSelection: () => ({ anchorNode: page.contentDOM }) });
        const event = clipboardEvent(BODY);
        handleCut(pluginFor(doc, BODY), event as never);
        expect(event.defaultPrevented).toBe(true);
        expect(event.written["text/plain"]).toContain("[^1]: one");
        expect(doc.lines.join("\n")).not.toContain("[^1]: one");
    });

    it("control: a copy fired at the body while the page's selection is elsewhere (text in a side pane) is left alone", () => {
        const { doc } = phoneEditor(BODY, { elsewhere: true });
        const event = clipboardEvent(BODY);
        handleCopy(pluginFor(doc, BODY), event as never);
        expect(event.defaultPrevented).toBe(false);
        expect(event.written).toEqual({});
    });

    it("control: a cut fired at a typing field outside the note is left alone even if the page's selection still reads as the note's", () => {
        const page = phoneEditor(BODY, null);
        const { doc } = page;
        Object.assign((page.contentDOM as { ownerDocument: object }).ownerDocument, { getSelection: () => ({ anchorNode: page.contentDOM }) });
        const field: FakeElement = { tagName: "INPUT", isContentEditable: false };
        const event = clipboardEvent(field);
        handleCut(pluginFor(doc, field), event as never);
        expect(event.defaultPrevented).toBe(false);
        expect(doc.lines).toEqual(NOTE);
    });
});
