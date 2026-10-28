import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { endOfWordOffset } from "../../src/editor/cursor-motion";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// BUG: the end-of-word walk hops an apostrophe or a full stop without
// looking at what comes next, so it can stop in the middle of a word.
//
// What the user would see, pressing the numbered hotkey with the caret
// inside the first half of the word:
//   I don't worry        becomes   I don'[^1]t worry
//   the U.S. said        becomes   the U.[^1]S. said
//   visit example.com    becomes   visit example.[^1]com
// and linting an existing note does the same to prose it never should
// have touched:
//   Marx[^1]'s theory    becomes   Marx'[^1]s theory
//   the U[^1].S. said    becomes   the U.[^1]S. said
//
// Hunt: 2026-09-13. Lens: the landing convention.
//
// Source of truth:
//  - GLOSSARY.md, "End-of-word adjustment": moving an insertion point to
//    the end of the word "(and past trailing punctuation) under the
//    caret, so mid-word presses don't split words".
//  - README, line ~166: the setting "places the reference at the end of
//    the word, past any closing quotation marks, brackets, or emphasis
//    and the punctuation after them, so you don't have to aim".
//  - TrailingPunctuationChars' own description in markdown-scan.ts: the
//    class is TRAILING punctuation, which an apostrophe or a full stop in
//    the middle of a word is not.
//
// WHAT IS PINNED HERE, and what deliberately is not: the exact landing is
// Jason's ruling and two readings are still open. One says the walk should
// resume over the rest of the word ("don't" to 5, "U.S." to 8); the other
// says it should stop BEFORE a mark that has a word character after it,
// which is what keeps lint from touching "Marx[^1]'s" at all. The two give
// different offsets, so this file asserts only the part both agree on: the
// landing is never between a mark and a word character.
//
// Scope: the table-cell path is endOfWordOffset itself, so those cases are
// certain. The main-editor press below runs on the fake editor's word
// lookup, so it additionally assumes Obsidian's wordAt does not include
// the apostrophe (that matches CodeMirror's default word characters, and
// is worth one live check in the real app).
//
// Note the commoner press is already fine: with the caret AFTER the
// apostrophe, the walk starts past it and lands at the end of the word.

const WordChar = /[\p{L}\p{N}]/u;

/** true when the landing splits a word: a mark behind it, a word character in front of it */
function landsBetweenMarkAndWord(text: string, at: number): boolean {
    if (at <= 0 || at >= text.length) return false;
    return "'\u2019.".includes(text[at - 1]) && WordChar.test(text[at]);
}

const pressSettings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    enableRemoveBlankLastLines: true,
};

describe("the walk never stops between a mark and a word character", () => {
    it("a straight-apostrophe contraction", () => {
        const line = "don't worry";
        expect(landsBetweenMarkAndWord(line, endOfWordOffset(line, 1))).toBe(false);
    });

    it("a curly-apostrophe contraction", () => {
        const line = "don\u2019t worry";
        expect(landsBetweenMarkAndWord(line, endOfWordOffset(line, 1))).toBe(false);
    });

    it("an abbreviation", () => {
        const line = "the U.S. said";
        expect(
            landsBetweenMarkAndWord(line, endOfWordOffset(line, line.indexOf("U"))),
        ).toBe(false);
    });

    it("a bare domain name", () => {
        const line = "visit example.com today";
        expect(
            landsBetweenMarkAndWord(
                line,
                endOfWordOffset(line, line.indexOf("example") + 2),
            ),
        ).toBe(false);
    });

    // Controls, green today and green under either ruling.
    it("a caret already past the apostrophe lands at the word's end (control)", () => {
        const line = "don't worry";
        const at = endOfWordOffset(line, 4);
        expect(landsBetweenMarkAndWord(line, at)).toBe(false);
        expect(at).toBe("don't".length);
    });

    it("a plural possessive's closing apostrophe is a real word end (control)", () => {
        const line = "the words' edge";
        const at = endOfWordOffset(line, 5);
        expect(landsBetweenMarkAndWord(line, at)).toBe(false);
        expect(at).toBe("the words'".length);
    });
});

describe("the numbered press never splits a word", () => {
    it("a contraction stays whole", async () => {
        const doc = fakeEditor(["I don't worry"], {
            cursor: { line: 0, ch: 3 },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(pressSettings, doc));
        expect(doc.lines[0]).not.toContain("'[^1]t");
    });
});

describe("the punctuation lint rule never splits a word", () => {
    it("a possessive keeps its apostrophe and its s together", () => {
        expect(footnoteAfterPunctuation("Marx[^1]'s theory")).not.toContain("'[^1]s");
    });

    it("an abbreviation is not cut open", () => {
        expect(footnoteAfterPunctuation("the U[^1].S. said")).not.toContain(".[^1]S");
    });

    // The control: a reference at the end of a real word, with a real
    // trailing full stop, still moves past that stop.
    it("a plain sentence-ending reference still hops its full stop (control)", () => {
        expect(footnoteAfterPunctuation("the word[^1]. Next")).toBe("the word.[^1] Next");
    });
});
