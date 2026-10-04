import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { endOfWordOffset } from "../../src/editor/cursor-motion";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// spec question: which characters belong to the landing convention, and
// does the walk need to know about wikilink aliases?
//
// Hunt: 2026-09-13. Lens: the landing convention.
//
// TWO SEPARATE QUESTIONS, both for Jason.
//
// 1. The one-character ellipsis "\u2026".
//    The three-dot "..." is hopped (pinned in end-of-word-offset.test.ts);
//    the single character Obsidian's smart typography and most pasted
//    prose produce is not in TrailingPunctuationChars.
//    Reading A: the class should grow the member, because a reader cannot
//    tell the two spellings apart and the plugin should not either. That
//    is exactly how the CJK marks were settled on 2026-08-10.
//    Reading B: the class is a closed, deliberately small enumeration and
//    stays as it is, so nobody has to keep a growing Unicode list in step
//    across the three paths that share it.
//    Either way the two paths AGREE with each other today (the insert and
//    the lint rule both leave the single character alone), so this is a
//    question about the class, not an inconsistency bug.
//
// 2. An aliased wikilink, "[[some bravo|alias]]".
//    The walk has no model of wikilinks at all. The plain "[[some bravo]]"
//    case in the manual numbered-footnotes tests passes only by luck: "]" happens to be a closing
//    mark. With an alias the walk stops dead at the "|", so a press on the
//    target word writes the reference INSIDE the link target and the link
//    stops resolving.
//    Reading A: this is the link rule missing a case, and the walk should
//    step over a whole "[[...]]" the way it steps over "[text](url)".
//    Reading B: a press inside a wikilink's target is a user error, and
//    the press should refuse rather than guess where the reference goes.
//    Under reading A the assertions below are the wanted values; under
//    reading B they become a refusal test instead. Either way today's
//    silent link-breaking is not the answer.
//
// Source of truth for the shapes themselves: the manual numbered-footnotes tests (the closing
// marks list and the "[[some bravo]]" line), TrailingPunctuationChars and
// ClosingMarkChars in markdown-scan.ts, and the 2026-08-10 CJK ruling as
// the precedent for how the class grows.
//
// Noted, not asserted: a third wording question is open on the same
// convention, whether a reference already after a full stop but INSIDE a
// closing quote ('"quoted.[^q]" rest') should be moved outside the quote.
// That one was ruled on in 5ec4b66 and is pinned in
// test/footnote-after-punctuation.test.ts, so nothing here asserts against
// it.

const pressSettings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    enableRemoveBlankLastLines: true,
};

describe("question 1: the one-character ellipsis", () => {
    it("the insert hops it the way it hops three dots", () => {
        expect(endOfWordOffset("wait\u2026 what", 2)).toBe(5);
    });

    it("the lint rule moves a reference past it the way it does three dots", () => {
        expect(footnoteAfterPunctuation("so[^1]\u2026")).toBe("so\u2026[^1]");
    });

    it("three dots are hopped by both paths today (control)", () => {
        expect(endOfWordOffset("wait... what", 2)).toBe(7);
        expect(footnoteAfterPunctuation("so[^1]...")).toBe("so...[^1]");
    });
});

describe("question 2: an aliased wikilink", () => {
    it("the walk steps over the whole aliased link", () => {
        const line = "A wikilink: [[some bravo|alias]].";
        expect(endOfWordOffset(line, line.indexOf("bravo") + 2)).toBe(line.length);
    });

    it("the numbered press does not write into the link target", async () => {
        const line = "A wikilink: [[some bravo|alias]] end";
        const doc = fakeEditor([line], {
            cursor: { line: 0, ch: line.indexOf("bravo") + 2 },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(pressSettings, doc));
        expect(doc.lines[0]).toBe("A wikilink: [[some bravo|alias]][^1] end");
    });

    it("a plain wikilink is stepped over today (control)", () => {
        const line = "A wikilink: [[some bravo]].";
        expect(endOfWordOffset(line, line.indexOf("bravo") + 2)).toBe(line.length);
    });
});
