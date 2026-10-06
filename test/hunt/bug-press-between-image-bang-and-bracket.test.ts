import { beforeEach, describe, expect, it } from "vitest";

import { insertInTableCell } from "../../src/commands/create-footnote";
import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import type { TableCellEditor } from "../../src/editor/table-cursor";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// BUG (wrong output): a press with the caret between the "!" and the "["
// of an image or an embed writes the footnote there, and the picture turns
// into a plain link without a word.
//
// What the user would see: in "see chart![[f.png]] more", with "Insert at
// end of word" off and the caret right after the "!", a numbered press
// writes "see chart![^1][[f.png]] more". Reading view now shows a stray
// "!", a footnote number, and a link to f.png where the picture was. The
// same with a Markdown image "![alt](p.png)", with the named key, with a
// selection "chart!" that ends at the "!" (numbered and inline keys), and
// with a press in a table cell. Every other caret inside the same embed is
// refused with the link notice.
//
// An "embed" is Obsidian's "![[file]]", which shows the file in the note;
// without its "!", "[[file]]" is a plain link to the file.
//
// Hunt 2026-10-06, cycle 4, lens press. Cluster P2.
//
// Origin: pre-existing.
//
// Source of truth: CommonMark 6.4 (an image is "!" immediately followed by
// a link; split, it is a "!" and a link) and Obsidian's embed syntax
// "![[file]]"; the press's own refusal of every other caret inside the
// embed (the link notice); the fixed pin bug-punctuation-splits-image-bang
// (a footnote never splits an image's "!" from its "[").
//
// Cause: the check that refuses a press inside a link (pressLineVerdict in
// src/editor/insertion-liveness.ts, through its count of drawn links, and
// the table cell's twin of it) compares how MANY links the line draws
// before and after the press. An embed that became a plain link, or an
// image that became a link, is still one link, so the count is the same
// and nothing is refused.

beforeEach(resetNotices);

const After = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    expandSelectionToWholeWords: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

describe("the '!' of an image or embed split from its '['", () => {
    const Off = { ...After, insertAtEndOfWord: false };

    // Now: "see chart![^1][[f.png]] more".
    it.fails("numbered press, end-of-word off, caret between '!' and '[[': refused like any caret inside the embed", async () => {
        const doc = fakeEditor(["see chart![[f.png]] more"], { cursor: { line: 0, ch: 10 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Off, doc));
        expect(doc.lines[0]).toContain("![[f.png]]");
    });

    // Now: "see chart![^1][alt](p.png) more".
    it.fails("numbered press, end-of-word off, caret between '!' and '[alt](p.png)' keeps the image", async () => {
        const doc = fakeEditor(["see chart![alt](p.png) more"], { cursor: { line: 0, ch: 10 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Off, doc));
        expect(doc.lines[0]).toContain("![alt](p.png)");
    });

    // Now: "see chart![^][[f.png]] more".
    it.fails("named key between '!' and '[[' keeps the embed", async () => {
        const doc = fakeEditor(["see chart![[f.png]] more"], { cursor: { line: 0, ch: 10 }, edits: true, wholeDoc: true, words: true });
        await insertNamedFootnote(fakePlugin(Off, doc));
        expect(doc.lines[0]).toContain("![[f.png]]");
    });

    // Now: "see[^1][[f.png]] more", the "!" gone into the footnote's text.
    it.fails("selection 'chart!' of 'see chart![[f.png]] more' keeps the embed", async () => {
        const doc = fakeEditor(["see chart![[f.png]] more"], {
            cursor: { line: 0, ch: 10 },
            selection: { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 10 } },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(After, doc));
        expect(doc.lines[0]).toContain("![[f.png]]");
    });

    // Now: "see^[chart!][[f.png]] more".
    it.fails("inline key on the selection 'chart!' keeps the embed", async () => {
        const doc = fakeEditor(["see chart![[f.png]] more"], {
            cursor: { line: 0, ch: 10 },
            selection: { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 10 } },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertInlineFootnote(fakePlugin(After, doc));
        expect(doc.lines[0]).toContain("![[f.png]]");
    });

    // A table cell is edited in its own small editor; this stands in for
    // it and records what the press writes. Now: one write, between the
    // "!" and the "[[".
    it.fails("cell press between '!' and '[[' writes nothing", () => {
        const dispatched: unknown[] = [];
        const cell = {
            state: { doc: { toString: () => "see chart![[f.png]] more" }, selection: { main: { head: 10, anchor: 10 } } },
            dispatch: (spec: unknown) => dispatched.push(spec),
        } as unknown as TableCellEditor;
        insertInTableCell(cell, fakePlugin({ insertAtEndOfWord: false }), "[^1]", 4);
        expect(dispatched).toEqual([]);
    });
});
