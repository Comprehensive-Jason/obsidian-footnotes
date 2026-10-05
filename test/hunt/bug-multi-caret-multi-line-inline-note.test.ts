import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { MultiCaretNestedNotice } from "../../src/editor/notice";
import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// bug: with several carets, a caret inside an inline footnote that runs
// over a line break is not seen as inside an inline footnote.
//
// Scenario: "text ^[an inline" / "note here] after", Alt-clicked carets,
// one of them between the brackets on either line. Obsidian reads the two
// lines as one inline footnote (its answers broad:20261004-726 and others;
// 2e58d86), and a single caret there hops out past the "]" (Jason,
// 2026-10-05, triage decision Q4).
//
// What it does now: the multi-caret press asks the one-line lookup
// (NoteReading.inlineNoteAt), which leaves such an inline footnote out. A
// caret in one counts as a caret on plain text: beside a caret in a
// one-line inline footnote the carets look mixed and the press refuses,
// and with every caret in the two-line one the press goes ahead and
// writes a reference inside it.
// What it should do: what the press does with every caret inside one-line
// inline footnotes: when every caret is in a filled inline footnote, one
// cursor hops out past the first of them; a caret in one beside a caret
// on plain text refuses with the multi-caret notice, as for a one-line
// inline footnote.
//
// Cause: caretArtifact in src/commands/multi-caret.ts used inlineNoteAt
// rather than inlineNoteHolding, which 2e58d86 added for the single-caret
// hop.
//
// Hunt 2026-10-05, cluster RD4 (follow-up to 2e58d86).
//
// Source of truth: the single-caret behaviour (spec-multi-line-inline-note-press)
// and the multi-caret continuation rules (test/multi-caret.test.ts, Jason's
// report 2026-08-27 and consistency ruling 2026-08-29).

const Settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

const Lines = ["text ^[an inline", "note here] after", "", "and ^[one line] too"];

beforeEach(() => {
    resetNotices();
});

describe("several carets and an inline footnote over two lines", () => {
    for (const [key, press] of [
        ["the numbered key", insertAutonumFootnote],
        ["the inline key", insertInlineFootnote],
    ] as const) {
        it(`${key}: one caret on each of its lines hops one cursor out past its "]"`, async () => {
            const doc = fakeEditor([...Lines], { carets: [{ line: 0, ch: 10 }, { line: 1, ch: 4 }], edits: true, wholeDoc: true, words: true });
            await press(fakePlugin(Settings, doc));
            expect(doc.lines).toEqual(Lines);
            expect(doc.getCursor()).toEqual({ line: 1, ch: "note here]".length });
            expect(messages()).toEqual([]);
        });

        it(`${key}: beside a caret in a one-line inline footnote, the cursor hops out past the first`, async () => {
            const doc = fakeEditor([...Lines], { carets: [{ line: 3, ch: 9 }, { line: 1, ch: 4 }], edits: true, wholeDoc: true, words: true });
            await press(fakePlugin(Settings, doc));
            expect(doc.lines).toEqual(Lines);
            expect(doc.getCursor()).toEqual({ line: 1, ch: "note here]".length });
            expect(messages()).toEqual([]);
        });

        it(`${key}: beside a caret on plain text, the press refuses`, async () => {
            const doc = fakeEditor([...Lines], { carets: [{ line: 1, ch: 4 }, { line: 1, ch: 14 }], edits: true, wholeDoc: true, words: true });
            await press(fakePlugin(Settings, doc));
            expect(doc.lines).toEqual(Lines);
            expect(messages()).toEqual([MultiCaretNestedNotice]);
        });
    }
});
