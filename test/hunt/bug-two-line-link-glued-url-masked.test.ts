import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// BUG (annoyance): a press inside a link whose text runs over two lines
// lands on the wrong side of a closing mark when a bare web address or
// email is glued to that mark after the link.
//
// A "closing mark" is the end of a formatting pair or a quotation, such as
// "==" (highlight) or a closing quote. A "bare" address is one typed as
// plain text, which Reading view turns into a link on its own.
//
// What the user would see: in "see [some" / "text](http://u)==https://e.com
// more", with the caret in "some" on the first line, a numbered press
// writes "text](http://u)==[^1]https://e.com more", after the "==". The
// same press with the caret in "text" on the second line writes
// "text](http://u)[^1]==https://e.com more", in front of it. The same
// with a closing quote glued to an email, 'text](http://u)"me@x.org more'.
// Where the footnote lands depends on which line the caret was on.
//
// Hunt 2026-10-06, cycle 5, lens press. Cluster X4.
//
// Origin: pre-existing.
//
// Source of truth: the press on the second line, which reads the line as
// written; Jason's triage decision Q1 (2026-10-05: a press inside a link
// over a line break lands after the link, as on one line); landing.ts's
// charter that the press and the lint never disagree about where a
// reference belongs. The lint's half of the same disagreement was fixed by
// 01f99c1 (hunt cycle 4, pin bug-lint-press-disagree-glued-url).
//
// Cause: the two-line branch of adjustFootnotePosition in
// src/editor/cursor-motion.ts walks past the link's end on that line's
// masked twin (the copy of the line with protected text and addresses
// blanked out). There the address after "==" is blank, so "==" looks like
// the end of the text and the walk steps over it. The one-line branch
// walks the line as written, where the address follows the mark, and stops
// in front of it.

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

/** The note after a numbered press with the caret at `cursor`. */
async function press(lines: string[], cursor: { line: number; ch: number }) {
    const doc = fakeEditor(lines, { cursor, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(After, doc));
    return doc;
}

describe("a press inside a link over two lines, with a closing mark glued to a bare address after it", () => {
    // Now: from line 1, "text](http://u)==[^1]https://e.com more"; from
    // line 2, "text](http://u)[^1]==https://e.com more".
    it.fails("lands where the one-line press on the second line lands", async () => {
        const lines = ["see [some", "text](http://u)==https://e.com more"];
        const fromLineOne = await press(lines, { line: 0, ch: 6 });
        const fromLineTwo = await press(lines, { line: 1, ch: 1 });
        expect(fromLineOne.lines[1]).toBe(fromLineTwo.lines[1]);
    });

    // Now: from line 1, 'text](http://u)"[^1]me@x.org more'; from line 2,
    // 'text](http://u)[^1]"me@x.org more'.
    it.fails("the same with an email glued to a closing quote", async () => {
        const lines = ['see "[some', 'text](http://u)"me@x.org more'];
        const fromLineOne = await press(lines, { line: 0, ch: 7 });
        const fromLineTwo = await press(lines, { line: 1, ch: 1 });
        expect(fromLineOne.lines[1]).toBe(fromLineTwo.lines[1]);
    });
});
