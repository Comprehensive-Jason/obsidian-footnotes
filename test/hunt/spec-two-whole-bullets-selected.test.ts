import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";

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

describe("spec question: two whole bullets of a three-bullet list selected", () => {
    it("control: the whole list converts as whole blocks", async () => {
        const doc = await pressOver({ line: 2, ch: 0 }, { line: 5, ch: 0 });
        expect(messages()).toEqual([]);
        expect(doc.lines[2]).toBe("[^1]");
    });

    // Now: refused with "No footnote was created: the selection takes part
    // of the line's formatting. Select the whole line, or only its text."
    it.fails.each([
        ["with the line break (a triple-click dragged down)", { line: 4, ch: 0 }],
        ["without the last line break", { line: 3, ch: 14 }],
    ])("spec (c), %s: refused with a notice that does not say to select the whole line", async (_what, head) => {
        const doc = await pressOver({ line: 2, ch: 0 }, head);
        expect(doc.lines).toEqual(list);
        expect(messages().filter((m) => m.startsWith("No footnote was created"))).toHaveLength(1);
        expect(messages().filter((m) => m.includes("Select the whole line"))).toEqual([]);
    });
});
