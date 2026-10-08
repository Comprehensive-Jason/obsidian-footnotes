import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { PartOfListNotice } from "../../src/commands/selection-footnote";

// spec question: two whole bullets of a longer list are selected and the
// numbered key pressed. What should happen?
//
// What it does now: the list is "- First point", "- Second point", "- Third
// point", between "Intro." and "After.". The user selects the first two
// bullets whole (a triple-click dragged down one line, or a drag from the
// start of the first to the end of the second) and presses the numbered
// key. The press is refused with "No footnote was created: the selection
// takes part of the line's formatting. Select the whole line, or only its
// text." The user did select whole lines, so the advice tells them to do
// what they did. One bullet selected whole converts its text (Jason's
// ruling Q27), and the whole list selected converts as whole blocks
// (Jason's ruling Q25).
// What a user might expect: a conversion, or a refusal whose advice they
// can follow.
//
// Options:
// (a) Convert as whole blocks when the list is bulleted: "[^1]" takes the
//     two bullets' place above "- Third point", and the footnote holds
//     them as a list.
// (b) Convert as Q27 does for one bullet: one bullet "- [^1]" stays, and
//     the footnote holds both items' text.
// (c) Keep refusing, with a notice that fits, such as "Select the whole
//     list, or one item's text." (recommended: (a) cannot hold for a
//     numbered list, where "[^1]" over "3. Third point" would make that
//     item more of the "[^1]" paragraph, since a list starting at 3 cannot
//     interrupt a paragraph, rule B5; and (b) takes a bullet out of the
//     list and puts two items into one footnote, which the user did not
//     ask for.)
// The tests assert (c): the press is refused, the note is unchanged, and
// the notice does not tell the user to select the whole line.
//
// Answered (Jason's ruling Q31, 2026-10-08), option (c): a selection of
// some but not all of a list's items, each whole, is refused, the note
// unchanged, with "No footnote was created: select one item's text, or the
// whole list." (PartOfListNotice, his pick of the three drafts). The tests
// below were it.fails until then; the last two bullets, a numbered list,
// and a list with blank lines between its items were added with the fix.
//
// Why it is a question and not a bug: the refusal itself is the result
// gate doing its job. The "result gate" is the one check every edit passes
// before it is written: the note after must read the same as the note
// before, except for what the edit meant to change. Here "- Third point"
// would come to start the list, and away from the user's own text a change
// in which line starts a block counts. Q27 rules on one whole bullet and
// Q25 on whole blocks; two whole items of a longer list fall between
// them, so which of the three it is is Jason's call. Only the notice's
// advice is plainly wrong, and its wording is his to pick.
//
// Hunt 2026-10-08, cycle 7. Cluster Y12, triage question Q31.
//
// Origin: pre-existing, refused the same way at 97abeac, this cycle's
// origin. The notice's wording dates from 28c5cdc (2026-10-08).
//
// Source of truth: Jason's ruling Q27 (sprout-c6-rulings.md 4,
// 2026-10-08) covers one bullet; Q25, extended (sprout-c6-rulings.md 2):
// "A selection of whole blocks still converts.";
// docs/obsidian-reading-rules.md B5 (an ordered marker other than 1 cannot
// interrupt a paragraph); the notice's own words, SelectionFormattingNotice in
// src/commands/selection-footnote.ts. Nearest open pin:
// spec-whole-bullet-line-selection (cycle 6, Q27).

const list = ["Intro.", "", "- First point", "- Second point", "- Third point", "", "After."];

/** Selects from `anchor` to `head` in the list note, presses the numbered key at the default settings with the popup off, and returns the editor. */
async function pressOver(anchor: { line: number; ch: number }, head: { line: number; ch: number }) {
    const doc = fakeEditor([...list], { cursor: head, selection: { anchor, head }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, doc));
    return doc;
}

beforeEach(resetNotices);

describe("Q31: two whole bullets of a three-bullet list selected", () => {
    it("control: the whole list converts as whole blocks", async () => {
        const doc = await pressOver({ line: 2, ch: 0 }, { line: 5, ch: 0 });
        expect(messages()).toEqual([]);
        expect(doc.lines[2]).toBe("[^1]");
    });

    // Before the ruling: refused with "No footnote was created: the
    // selection takes part of the line's formatting. Select the whole line,
    // or only its text."
    it.each([
        ["with the line break (a triple-click dragged down)", { line: 4, ch: 0 }],
        ["without the last line break", { line: 3, ch: 14 }],
    ])("ruling (c), %s: refused with the notice that says to select one item's text or the whole list", async (_what, head) => {
        const doc = await pressOver({ line: 2, ch: 0 }, head);
        expect(doc.lines).toEqual(list);
        expect(messages()).toEqual([PartOfListNotice]);
    });

    it("the last two bullets: refused the same way", async () => {
        const doc = await pressOver({ line: 3, ch: 0 }, { line: 5, ch: 0 });
        expect(doc.lines).toEqual(list);
        expect(messages()).toEqual([PartOfListNotice]);
    });

    it("two items of a numbered list, and two of a list with blank lines between its items: refused the same way", async () => {
        const numbered = ["Intro.", "", "1. First", "2. Second", "3. Third", "", "After."];
        const first = fakeEditor([...numbered], { cursor: { line: 4, ch: 0 }, selection: { anchor: { line: 2, ch: 0 }, head: { line: 4, ch: 0 } }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, first));
        expect(first.lines).toEqual(numbered);
        expect(messages()).toEqual([PartOfListNotice]);
        resetNotices();
        const loose = ["Intro.", "", "- First", "", "- Second", "", "- Third", "", "After."];
        const second = fakeEditor([...loose], { cursor: { line: 7, ch: 0 }, selection: { anchor: { line: 4, ch: 0 }, head: { line: 7, ch: 0 } }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, second));
        expect(second.lines).toEqual(loose);
        expect(messages()).toEqual([PartOfListNotice]);
    });

    it("control: the whole list with the paragraph after it converts as whole blocks", async () => {
        const doc = await pressOver({ line: 2, ch: 0 }, { line: 6, ch: 6 });
        expect(messages()).toEqual([]);
        expect(doc.lines[2]).toBe("[^1]");
    });
});
