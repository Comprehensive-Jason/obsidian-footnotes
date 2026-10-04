import { EditorPosition } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { noticed, resetNotices } from "./helpers/notices";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";

import FootnotePlugin from "../src/main";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
    pasteInlineFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import { NestedFootnoteNotice } from "../src/editor/notice";

// Jason's ruling (2026-08-13, from manual testing): Obsidian technically
// renders footnotes nested inside footnote definitions, but that's wildly
// nonstandard markdown and the plugin must not CREATE it - the inline key
// used to happily plant "^[]" into a definition body. Every creation path
// now refuses anywhere inside a definition block (body after the label,
// continuation lines); label-line navigation and the definition-creation
// cascade step are untouched.

function fakeEditor(
    lines: string[],
    cursor: EditorPosition,
    selection?: { anchor: EditorPosition; head: EditorPosition },
): FakeEditor {
    return sharedFakeEditor(lines, {
        cursor,
        selection,
        edits: true,
        wholeDoc: true,
    });
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

beforeEach(() => {
    resetNotices();
});
afterEach(() => {
    vi.unstubAllGlobals();
});

const LINES = [
    "alpha[^1] prose here",
    "",
    "[^1]: definition body text",
    "    continued definition line",
];

describe("the inline pair NAVIGATES from inside a definition (ruling refined 2026-08-13)", () => {
    // first ruling: refuse with a toast. Refined the same day: jump back
    // to the reference EXACTLY like the numbered/named keys - same
    // shouldJumpFromDefinitionToReference step, wired at the entries
    it("inline key in the definition body jumps to the reference", async () => {
        const doc = fakeEditor(LINES, { line: 2, ch: 15 });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(noticed(NestedFootnoteNotice)).toBe(false);
        expect(doc.cursor.line).toBe(0);
    });

    it("inline key on a continuation line jumps too", async () => {
        const doc = fakeEditor(LINES, { line: 3, ch: 10 });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(noticed(NestedFootnoteNotice)).toBe(false);
        expect(doc.cursor.line).toBe(0);
    });

    it("paste key jumps before the clipboard is ever read", async () => {
        const reads = { count: 0 };
        vi.stubGlobal("navigator", {
            clipboard: {
                readText: () => {
                    reads.count++;
                    return Promise.resolve("clip");
                },
            },
        });
        const doc = fakeEditor(LINES, { line: 2, ch: 15 });
        await pasteInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(doc.cursor.line).toBe(0);
        expect(reads.count).toBe(0);
    });

    it("a label-shaped line inside a fence is no jump target (#41)", async () => {
        const fenced = ["```", "[^x]: t", "```", "prose"];
        const doc = fakeEditor(fenced, { line: 1, ch: 3 });
        await insertInlineFootnote(fakePlugin(doc));
        // no jump AND no insert - the protected-caret guard owns it
        expect(doc.lines).toEqual(fenced);
        expect(doc.cursor).toEqual({ line: 1, ch: 3 });
    });

    // Corrected 2026-10-03 (the runtime swap): "[^a`[`b]: c" is a
    // definition named "a`[`b" in the note reading, since remark-footnotes'
    // label reader runs to the first "]" and stops only at whitespace, the
    // way rule E5 found Obsidian reads a reference's name. Obsidian reads
    // and renders it so (live answer swap34:name-bracket-code, with
    // Reading view, 2026-10-03). A press in its text is a press inside a
    // definition, which nests nothing: no "^[]" is written.
    it("a name holding a bracket still names a definition: the press inside it writes nothing", async () => {
        const doc = fakeEditor(["[^a`[`b]: c"], { line: 0, ch: 10 });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["[^a`[`b]: c"]);
    });

    it("autonum key on a continuation line NAVIGATES instead of creating", async () => {
        // the numbered/named cascade's jump step claims definition-block
        // presses (multiline-definition-jump) before creation could nest -
        // the new guard is their backstop, and the working refusal for the
        // inline pair below
        const doc = fakeEditor(LINES, { line: 3, ch: 10 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(noticed(NestedFootnoteNotice)).toBe(false);
        expect(doc.cursor.line).toBe(0);
    });

    it("named key on a continuation line navigates the same way", async () => {
        const doc = fakeEditor(LINES, { line: 3, ch: 10 });
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(noticed(NestedFootnoteNotice)).toBe(false);
        expect(doc.cursor.line).toBe(0);
    });

    it("a selection inside the definition body refuses conversion", async () => {
        const doc = fakeEditor(LINES, { line: 2, ch: 6 }, {
            anchor: { line: 2, ch: 6 },
            head: { line: 2, ch: 16 },
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(noticed(NestedFootnoteNotice)).toBe(true);
    });
});

describe("what stays untouched", () => {
    it("the label line still navigates back to the reference", async () => {
        const doc = fakeEditor(LINES, { line: 2, ch: 2 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(LINES);
        expect(noticed(NestedFootnoteNotice)).toBe(false);
        // jumped to the reference on line 0
        expect(doc.cursor.line).toBe(0);
    });

    it("ordinary prose still creates", async () => {
        const doc = fakeEditor(LINES, { line: 0, ch: 15 });
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines[0]).toBe("alpha[^1] prose^[] here");
        expect(noticed(NestedFootnoteNotice)).toBe(false);
    });
});
