import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { pasteInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (wrong output): after copying text that holds a reference, the
// "Paste as inline footnote" key pastes the copied definition's label into
// the inline footnote as text.
//
// What the user would see: they copy "a[^1] b" from a note where
// "[^1]: one" defines it. Since 0.3.0 the copy writes the definition into
// the clipboard text too, so the clipboard holds "a[^1] b", a blank line
// and "[^1]: one". Pressing "Paste as inline footnote" after "x" gives
// "x^[a[^1] b [^1]: one]": the definition's label "[^1]:" is flattened
// into the footnote's text as if it were prose.
//
// Hunt 2026-10-02, round 2, lens interactions. Cluster I3 (the label half;
// the nesting half is spec-paste-inline-key-nests-carried-reference).
//
// Source of truth: the carry design (Jason, 2026-09-22): the definition
// lines in the clipboard are there for the paste to land as definitions,
// not as text. A definition label is never prose.
//
// Fix (2026-10-06): readInlineFootnoteFromClipboard, which the single-caret
// and the multi-caret paste both read the clipboard through, takes the
// trailing definitions off the text the way a paste does
// (splitCarriedText) before making it a footnote body.

// Makes navigator.clipboard.readText hand back `text`.
function stubClipboard(text: string) {
    vi.stubGlobal("navigator", { clipboard: { readText: () => Promise.resolve(text) } });
}

const base = {
    carryFootnotesOnCopy: true,
    enablePopupEditor: false,
    insertAtEndOfWord: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("copy with carried definitions, then the paste-as-inline key", () => {
    it("does not flatten the copied definition's label into the inline footnote", async () => {
        const src = fakeEditor(["a[^1] b", "", "[^1]: one"], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: 0 },
            selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 7 } },
        });
        const e = {
            written: {} as Record<string, string>,
            defaultPrevented: false,
            clipboardData: { types: ["text/plain"], getData: () => "", setData: (t: string, v: string) => (e.written[t] = v) },
            preventDefault() {
                e.defaultPrevented = true;
            },
            stopPropagation() {},
        };
        handleCopy(fakePlugin({ ...base }, src), e as never);
        const clip = e.written["text/plain"];
        expect(clip).toBe("a[^1] b\n\n[^1]: one");
        stubClipboard(clip);
        const doc = fakeEditor(["x"], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 1 } });
        await pasteInlineFootnote(fakePlugin({ ...base }, doc));
        // Today: "x^[a[^1] b [^1]: one]".
        expect(doc.lines.join("\n")).not.toContain("[^1]: one]");
    });

    it("multi-caret: the same clipboard leaves the label out at every caret", async () => {
        stubClipboard("a[^1] b" + String.fromCharCode(10, 10) + "[^1]: one");
        const doc = fakeEditor(["x y"], { wholeDoc: true, edits: true, carets: [{ line: 0, ch: 1 }, { line: 0, ch: 3 }] });
        await pasteInlineFootnote(fakePlugin({ ...base }, doc));
        // Before the fix: "x^[a[^1] b [^1]: one] y^[a[^1] b [^1]: one]".
        expect(doc.lines.join(String.fromCharCode(10))).toBe("x^[a[^1] b] y^[a[^1] b]");
    });
});
