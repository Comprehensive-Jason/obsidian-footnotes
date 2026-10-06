import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// spec question: when the caret sits right after a word and right before
// a link glued to that word, should the footnote go at the end of the
// word or after the link?
//
// An "embed" is Obsidian's "![[file]]", which shows the file (often a
// picture) in the note. A link is "glued" to a word when no space sits
// between them, as in "chart![[f.png]]" or "see[x](u)".
//
// What it does now: with "Insert at end of word" on, a numbered press with
// the caret right after "chart" in "chart![[f.png]] more" (touching the
// word on its left and the embed's "!" on its right) writes
// "chart![[f.png]][^1] more", after the embed. A caret one place to the
// left, inside the word, writes "chart[^1]![[f.png]] more", in front of
// it. The same for "see[x](u) more" with the caret between "see" and "[":
// the footnote lands after the link.
// What a user might expect: the footnote at the end of the word the caret
// touches, as for a caret inside that word. An embed is often a picture on
// its own, so landing after it moves the footnote number from the word to
// below the picture.
// Why it is a question and not a bug: the caret touches both the word and
// the link, and the press counts a caret at a link's first character as
// inside the link, where it always lands after the link. Which of the two
// the caret belongs to is a choice.
//
// Options:
//   (a) a caret that touches a word on its left lands at the end of that
//       word, in front of a glued link, as a caret inside the word does;
//   (b) keep it as it is: a caret at a link's first character is inside
//       the link and lands after it.
// The tests below take option (a).
//
// Hunt 2026-10-06, cycle 5, lens press. Cluster X5.
//
// Origin: pre-existing (linkLikeEndAt has held the caret since c6ee2fa).
//
// Source of truth: Jason's landing rulings (2026-09-15: a press "in or
// just after a word" lands at the end of that word; a reference never
// splits a link); the press one place to the left.
//
// Where it happens: adjustFootnotePosition in src/editor/cursor-motion.ts
// asks linkLikeEndAt (src/parsing/landing.ts) first, and a link holds the
// caret when the caret is at or after the link's first character, so the
// word walk never gets a say.

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

/** The note after a numbered press with the caret at `ch` of its first line. */
async function numbered(lines: string[], ch: number) {
    const doc = fakeEditor(lines, { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(After, doc));
    return doc;
}

describe("the caret at the boundary between a word and a glued link", () => {
    it("control: a caret inside the word lands in front of the embed", async () => {
        const doc = await numbered(["chart![[f.png]] more"], 4);
        expect(doc.lines[0]).toBe("chart[^1]![[f.png]] more");
    });

    // Now: "chart![[f.png]][^1] more".
    it.fails("just after the word, touching the embed: lands where the caret inside the word lands", async () => {
        const doc = await numbered(["chart![[f.png]] more"], 5);
        expect(doc.lines[0]).toBe("chart[^1]![[f.png]] more");
    });

    // Now: "see[x](u)[^1] more".
    it.fails("just after the word, touching an inline link: lands at the end of the word", async () => {
        const doc = await numbered(["see[x](u) more"], 3);
        expect(doc.lines[0]).toBe("see[^1][x](u) more");
    });
});
