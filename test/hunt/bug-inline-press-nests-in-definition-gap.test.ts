// Imported from the GLM sweep of 2026-09-13 (T3 Code worktree); 3 of 5 tests were red there and carry it.fails.
import { EditorPosition } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { noticed, resetNotices } from "../helpers/notices";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";

import FootnotePlugin from "../../src/main";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
    pasteInlineFootnote,
} from "../../src/commands/insert-or-navigate-footnotes";
import { NestedFootnoteNotice } from "../helpers/toasts";

// WHAT A USER SEES. The caret rests on the blank line INSIDE a footnote
// definition - the empty gap between two indented continuation lines, or
// the four-space separator line a multi-paragraph selection conversion
// writes between paragraphs. Every key must refuse there: the plugin
// never creates a footnote inside another footnote's definition (rulings
// 2026-08-13 and 2026-08-24), and the numbered and named keys do refuse,
// with the nesting toast.
//
// The inline and paste keys do not. Their cascade runs no
// definition-interior guard, and the jump step's cheap raw-line gate
// (/^\s+\S/ in shouldJumpFromDefinitionToReference) skips blank and
// whitespace-only lines before the definition blocks are ever consulted.
// So the press falls through to insertion:
//
//   - the inline key plants "^[]" in the gap, a nested inline footnote;
//   - the paste key plants the clipboard there the same way.
//
// Both create exactly the nested footnote every other key (and the lint
// alert) refuses, silently and with no toast.

beforeEach(() => {
    resetNotices();
});
afterEach(() => {
    vi.unstubAllGlobals();
});

// line 4 is the blank gap between the two continuation lines, inside the
// definition block (findDefinitionBlocks absorbs the blank run because
// "    cont two" follows it)
const GAP_LINES = [
    "alpha[^1] prose here",
    "",
    "[^1]: body",
    "    cont one",
    "",
    "    cont two",
];

// line 3 is the four-space whitespace-only separator a selection
// conversion writes between the paragraphs of a multi-paragraph body
// (indentDefinitionBody in selection-footnote.ts)
const CONVERTED_LINES = [
    "alpha[^1] prose here",
    "",
    "[^1]: first paragraph",
    "    ",
    "    second paragraph",
];

function fakeEditor(lines: string[], cursor: EditorPosition): FakeEditor {
    return sharedFakeEditor(lines, { cursor, edits: true, wholeDoc: true });
}

function fakePlugin(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: false,
            lintOnFootnoteCreation: false,
        },
        doc,
    );
}

describe("a press on the blank line inside a definition block", () => {
    it("the numbered key refuses (baseline)", async () => {
        const doc = fakeEditor(GAP_LINES, { line: 4, ch: 0 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(GAP_LINES);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });

    it("the named key refuses (baseline)", async () => {
        const doc = fakeEditor(GAP_LINES, { line: 4, ch: 0 });
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(GAP_LINES);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });

    it("the inline key must not plant ^[] in the gap", async () => {
        const doc = fakeEditor(GAP_LINES, { line: 4, ch: 0 });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(GAP_LINES);
    });

    it("the paste key must not plant the clipboard in the gap", async () => {
        vi.stubGlobal("navigator", {
            clipboard: { readText: () => Promise.resolve("clip") },
        });
        const doc = fakeEditor(GAP_LINES, { line: 4, ch: 0 });
        await pasteInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(GAP_LINES);
    });
});

describe("the same gap in a CONVERTED multi-paragraph definition", () => {
    it("the inline key must not plant ^[] on the four-space separator", async () => {
        const doc = fakeEditor(CONVERTED_LINES, { line: 3, ch: 2 });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(CONVERTED_LINES);
    });
});
