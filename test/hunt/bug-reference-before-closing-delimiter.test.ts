import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { adjustFootnotePosition, endOfWordOffset } from "../../src/editor/cursor-motion";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { referenceLandingAfter } from "../../src/parsing/landing";

// Jason's manual pass (2026-09-09): with "insert at end of word"
// on, a footnote placed on the last word of a quoted, bracketed, or
// emphasized phrase landed INSIDE the closing marks:
//   This is "some bravo[^1]".      wanted   This is "some bravo".[^1]
// The same for 'single quotes', (parentheses), [brackets], {braces},
// **bold**, *italics*, ==highlights==, and ~~strikethrough~~.
//
// The convention adopted (the Chicago Manual of Style's, which every
// major style guide shares): a note number follows the closing quotation
// mark or bracket AND any punctuation that follows the phrase. So the
// landing walks past every closing mark and punctuation character after
// the word, and a markdown link's "(url)" tail is stepped over whole, so
// the reference never splits "[text](url)".
//
// The lint rule "footnote after punctuation" follows the same convention,
// so a note typed the old way lints into the same shape the insert now
// produces.

describe("referenceLandingAfter walks past closing marks and punctuation", () => {
    it.each([
        ['This is "some bravo".', 'This is "some bravo'.length, 'This is "some bravo".'.length],
        ["This is 'some bravo'.", "This is 'some bravo".length, "This is 'some bravo'.".length],
        ["This is (some bravo).", "This is (some bravo".length, "This is (some bravo).".length],
        ["This is [some bravo].", "This is [some bravo".length, "This is [some bravo].".length],
        ["This is {some bravo}.", "This is {some bravo".length, "This is {some bravo}.".length],
        ["This is **some bravo**.", "This is **some bravo".length, "This is **some bravo**.".length],
        ["This is *some bravo*.", "This is *some bravo".length, "This is *some bravo*.".length],
        ["This is ==some bravo==.", "This is ==some bravo".length, "This is ==some bravo==.".length],
        ["This is ~~some bravo~~.", "This is ~~some bravo".length, "This is ~~some bravo~~.".length],
        // punctuation inside the quotes, American style, then the quote
        ['He said "bravo."', 'He said "bravo'.length, 'He said "bravo."'.length],
        // curly quotes and CJK closers count as closing marks too
        ["“some bravo”.", "“some bravo".length, "“some bravo”.".length],
        ["「一二」。", "「一二".length, "「一二」。".length],
        // a closing mark with nothing after it
        ["see (bravo)", "see (bravo".length, "see (bravo)".length],
        // a markdown link: the reference goes after the whole link, never between "]" and "("
        ["see [some bravo](https://x.y/z).", "see [some bravo".length, "see [some bravo](https://x.y/z).".length],
        // a wikilink
        ["see [[some bravo]].", "see [[some bravo".length, "see [[some bravo]].".length],
        // a space stops the walk; a following reference is not a closing mark
        ["bravo more", "bravo".length, "bravo".length],
        ["bravo[^2]", "bravo".length, "bravo".length],
    ])("%s", (text, from, expected) => {
        expect(referenceLandingAfter(text, from)).toBe(expected);
    });
});

describe("the end-of-word insertion lands after the closing marks", () => {
    it("in a table cell (endOfWordOffset)", () => {
        expect(endOfWordOffset('This is "some bravo".', 'This is "some br'.length)).toBe('This is "some bravo".'.length);
        expect(endOfWordOffset("This is **some bravo**.", "This is **some br".length)).toBe("This is **some bravo**.".length);
    });

    it("in the main editor (adjustFootnotePosition)", () => {
        const line = 'This is "some bravo".';
        const doc = fakeEditor([line], { words: true, cursor: { line: 0, ch: 'This is "some br'.length } });
        const plugin = fakePlugin({ insertAtEndOfWord: true });
        expect(adjustFootnotePosition({ line: 0, ch: 'This is "some br'.length }, doc, line, plugin)).toEqual({
            line: 0,
            ch: line.length,
        });
    });

    it("a markdown link's url tail is stepped over whole", () => {
        const line = "see [some bravo](https://x.y/z) more";
        const doc = fakeEditor([line], { words: true, cursor: { line: 0, ch: "see [some br".length } });
        const plugin = fakePlugin({ insertAtEndOfWord: true });
        expect(adjustFootnotePosition({ line: 0, ch: "see [some br".length }, doc, line, plugin)).toEqual({
            line: 0,
            ch: "see [some bravo](https://x.y/z)".length,
        });
    });
});

describe("the lint rule moves references past closing marks the same way", () => {
    it.each([
        ['This is "some bravo[^1]".', 'This is "some bravo".[^1]'],
        ["This is 'some bravo[^2]'.", "This is 'some bravo'.[^2]"],
        ["This is (some bravo[^3]).", "This is (some bravo).[^3]"],
        ["This is [some bravo[^4]].", "This is [some bravo].[^4]"],
        ["This is {some bravo[^5]}.", "This is {some bravo}.[^5]"],
        ["This is **some bravo[^6]**.", "This is **some bravo**.[^6]"],
        ["This is *some bravo[^7]*.", "This is *some bravo*.[^7]"],
        ["This is ==some bravo[^8]==.", "This is ==some bravo==.[^8]"],
        ["This is ~~some bravo[^9]~~.", "This is ~~some bravo~~.[^9]"],
        ["see [some bravo[^1]](https://x.y/z).", "see [some bravo](https://x.y/z).[^1]"],
        // a "[^1]" inside a wikilink's own brackets is part of the link
        // target, not a reference: Reading view renders no footnote there
        // (probed 2026-09-16, Kimi hunt cycle 1), so the rule leaves the
        // link alone rather than editing its target
        ["see [[some bravo[^1]]].", "see [[some bravo[^1]]]."],
        // a run of references moves as one unit, as before
        ["(bravo[^1][^2]).", "(bravo).[^1][^2]"],
    ])("%s", (before, after) => {
        expect(footnoteAfterPunctuation(before)).toBe(after);
        expect(footnoteAfterPunctuation(after)).toBe(after);
    });

    it("leaves a reference that already follows a closing mark alone", () => {
        for (const text of ['"quoted"[^1] and', "**bold**[^1] and", "(paren)[^1]. and", "word.[^1]"]) {
            expect(footnoteAfterPunctuation(text)).toBe(text);
        }
    });

    it("still ignores references inside code and definition labels", () => {
        expect(footnoteAfterPunctuation("`code[^1]`.")).toBe("`code[^1]`.");
        expect(footnoteAfterPunctuation('[^1]: "the definition".')).toBe('[^1]: "the definition".');
    });
});
