// BUG (wrong output): a selection holding a reference that has no
// definition yet converts into a footnote, and the plugin then refuses to
// write that reference's definition.
//
// What the user would see: a draft "Smith says[^smith] something." / "" /
// "Later text cites [^smith] again.", with [^smith] typed in two places
// to be defined later. They select the first sentence and press the
// numbered key. It converts: "[^1]" stays in the text and footnote 1
// reads "Smith says[^smith] something.", so [^smith] now sits inside
// footnote 1. When they later press the numbered key on the other
// [^smith] to write its definition, the press is refused with "No footnote
// was created: footnotes can't be nested inside other footnotes." The
// inline key and a table cell still refuse the first selection, as every
// key did before.
//
// Hunt 2026-10-09, cycle 8. Cluster V1, lens presses and selections.
// Source of truth: ADR 0001 ("A selection that contains or cuts through any
// live reference, placeholder, or inline footnote refuses to convert");
// CONTEXT.md "Live" (an undefined reference outside code is live); the
// plugin's own lint alert names the nesting the conversion makes.
// Origin: regression from 8ee7ca8 (Jason's ruling 1 of 2026-10-09: the
// gate's check 2 now counts a reference only when its name has a
// definition); green at 34d5377 and 3a47f7a. Ruling 1 itself asked only
// for more refusals.
// The "result gate" is the one check every edit passes before it is
// written: the note after must read the same as the note before, except
// for what the edit meant to change (ADR 0003).

// a selection holding a reference that
// has no definition yet now converts with the numbered key.
//
// The draft: "Smith says[^smith] something." / "" / "Later text cites
// [^smith] again." The user typed "[^smith]" in two places, meaning to
// write its definition later (an orphaned reference: nothing defines it
// yet). They select the first sentence whole and press the numbered key.
//
// ADR 0001's consequence: "A selection that contains or cuts through any
// live reference, placeholder, or inline footnote refuses to convert, with a
// toast." A "[^smith]" outside code is live in CONTEXT.md's sense (it parses
// as a footnote reference; only a fake inside protected text is not live).
// At 34d5377 and at 3a47f7a the press was refused with the nesting notice.
// Since 8ee7ca8 (Jason's ruling 1) gate check 2 counts a reference only when
// its name has a definition, so this selection passes and "[^smith]" moves
// into the new footnote's text: a footnote inside a footnote as soon as
// [^smith] is defined, and the plugin then refuses every press that would
// define it (ruling 1), so the draft's other "[^smith]" can no longer get
// its definition from the plugin. The inline key still refuses the same
// selection (the inline footnote's references count whether or not they are
// defined), so the two keys now disagree.
import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { selectionPressHandled } from "../../src/commands/selection-footnote";
import type { TableCellEditor } from "../../src/editor/table-cursor";
import { NestedFootnoteNotice } from "../../src/editor/notice";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

type Pos = { line: number; ch: number };
const settings = { ...DEFAULT_SETTINGS, enablePopupEditor: false };

async function select(lines: string[], anchor: Pos, head: Pos, press = insertAutonumFootnote) {
    const doc = fakeEditor(lines, { cursor: head, selection: { anchor, head }, edits: true, wholeDoc: true, words: true });
    await press(fakePlugin(settings, doc));
    return doc;
}

const DRAFT = ["Smith says[^smith] something.", "", "Later text cites [^smith] again."];

beforeEach(resetNotices);

describe("a selection holding a reference with no definition yet", () => {
    it.fails("the numbered key on the whole first sentence is refused with the nesting notice", async () => {
        const doc = await select(DRAFT, { line: 0, ch: 0 }, { line: 0, ch: 29 });
        expect(doc.lines).toEqual(DRAFT);
        expect(messages()).toContain(NestedFootnoteNotice);
    });

    it.fails("the numbered key on a whole bullet holding the reference is refused too", async () => {
        const lines = ["Profit rates fell[^smith] in the period.", "", "- Brenner disagrees[^smith].", "- Shaikh agrees.", "", "Closing."];
        const doc = await select(lines, { line: 2, ch: 0 }, { line: 2, ch: 28 });
        expect(doc.lines).toEqual(lines);
        expect(messages()).toContain(NestedFootnoteNotice);
    });

    it.fails("the numbered key on the last words of a sentence, the reference among them, is refused too", async () => {
        const lines = ["Brenner disagrees with Smith[^smith] on rates.", "", "Later [^smith] again."];
        const doc = await select(lines, { line: 0, ch: 18 }, { line: 0, ch: 46 });
        expect(doc.lines).toEqual(lines);
        expect(messages()).toContain(NestedFootnoteNotice);
    });

    it.fails("the named key on the same selection is refused before its name modal opens", async () => {
        // the modal is a no-op in the unit tests, so an opened modal shows
        // as no notice and no change; at 3a47f7a the gate's first ask,
        // under the next free number, refused before the modal
        const doc = await select(DRAFT, { line: 0, ch: 0 }, { line: 0, ch: 29 }, insertNamedFootnote);
        expect(doc.lines).toEqual(DRAFT);
        expect(messages()).toContain(NestedFootnoteNotice);
    });

    it("control: the lazy-label shape of bug-selection-lazy-label-nests-live-reference, with nothing defining [^x], is still refused (its label nests)", async () => {
        const lines = ["A paragraph of prose.", "[^x]: lazy label body", "", "Tail prose that mentions the footnote[^x] properly."];
        const doc = await select(lines, { line: 1, ch: 0 }, { line: 1, ch: lines[1].length });
        expect(doc.lines).toEqual(lines);
        expect(messages()).toContain(NestedFootnoteNotice);
    });

    it("control: a table cell's whole text holding the same undefined reference is still refused, so the cell and the main editor disagree", () => {
        const text = "falls[^smith] sharply";
        const dispatched: unknown[] = [];
        const cell: TableCellEditor = {
            state: { doc: { toString: () => text }, selection: { main: { head: text.length, anchor: 0 } } },
            dispatch: (spec) => {
                dispatched.push(spec);
            },
        };
        const lines = ["| Author | Claim |", "| --- | --- |", `| Smith | ${text} |`, "", "Later [^smith] again."];
        const doc = fakeEditor(lines, { cursor: { line: 2, ch: 10 }, edits: true, wholeDoc: true });
        selectionPressHandled(fakePlugin(settings, doc), doc, cell, "autonum", { line: 2, ch: 10 });
        expect(dispatched).toEqual([]);
        expect(messages()).toContain(NestedFootnoteNotice);
    });

    it("control: the inline key on the same selection is refused with the nesting notice", async () => {
        const doc = await select(DRAFT, { line: 0, ch: 0 }, { line: 0, ch: 29 }, insertInlineFootnote);
        expect(doc.lines).toEqual(DRAFT);
        expect(messages()).toContain(NestedFootnoteNotice);
    });

    it("control: with [^smith] defined, the numbered key on the same selection is refused", async () => {
        const lines = ["Smith says[^smith] something.", "", "[^smith]: Smith 2020."];
        const doc = await select(lines, { line: 0, ch: 0 }, { line: 0, ch: 29 });
        expect(doc.lines).toEqual(lines);
        expect(messages()).toContain(NestedFootnoteNotice);
    });

});
