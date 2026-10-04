import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { referenceLandingAfter } from "../../src/parsing/landing";

// BUG: a link whose web address contains its own pair of round brackets,
// like every Wikipedia disambiguation address, gets a footnote reference
// dropped into the middle of the address.
//
// What the user would see: pressing the numbered hotkey on the last word
// of the link text writes
//   see [bravo](https://en.wikipedia.org/wiki/Ba_(disambiguation)[^1]#hist) now
// instead of putting "[^1]" after the whole link. The link is broken from
// that moment on: the address stops at the reference. Linting an existing
// note does the same damage, and once the reference sits after a ")" the
// lint rule reads it as already correctly placed, so a second lint pass
// leaves it there for good. Nothing short of hand editing puts it back.
//
// Hunt: 2026-09-13. Lens: the landing convention.
//
// Source of truth:
//  - CommonMark 0.31.2, section 6.3: a link destination may contain
//    balanced parentheses, so "(...Ba_(disambiguation)#hist)" is ONE tail.
//  - manual former sheet 01, line ~30: "The link case lands after the whole
//    (url), never between ] and (".
//  - manual former sheet 20, line ~55: the same swap for the plain-link case in
//    the punctuation lint rule.
//  - referenceLandingAfter's own doc comment: "A markdown link's '(url)'
//    tail right after a ']' is stepped over whole, so the reference never
//    splits '[text](url)'."
//
// Cause: the walk finds the end of the tail with
// text.indexOf(")", at + 2), which is the FIRST ")" rather than the one
// that closes the tail.
//
// Settings: the defaults (end-of-word insertion on). Wikipedia addresses
// are everywhere in Jason's notes, so this is a common shape, not an
// exotic one.

const pressSettings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    enableRemoveBlankLastLines: true,
};

const LINK_LINE =
    "see [bravo](https://en.wikipedia.org/wiki/Ba_(disambiguation)#hist) now";

describe("a link address holding its own round brackets", () => {
    it("the walk steps over the whole address, not to its first ')'", () => {
        const endOfLinkText = LINK_LINE.indexOf("]");
        expect(referenceLandingAfter(LINK_LINE, endOfLinkText)).toBe(
            LINK_LINE.indexOf("#hist)") + "#hist)".length,
        );
    });

    it("the numbered press keeps the link whole", async () => {
        const doc = fakeEditor([LINK_LINE], {
            cursor: { line: 0, ch: LINK_LINE.indexOf("bravo") + 2 },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(pressSettings, doc));
        expect(doc.lines[0]).toBe(
            "see [bravo](https://en.wikipedia.org/wiki/Ba_(disambiguation)#hist)[^1] now",
        );
    });

    it("the punctuation lint rule moves the reference past the whole link", () => {
        expect(
            footnoteAfterPunctuation(
                "[linked[^k]](https://en.wikipedia.org/wiki/Ba_(disambiguation)#h).",
            ),
        ).toBe(
            "[linked](https://en.wikipedia.org/wiki/Ba_(disambiguation)#h).[^k]",
        );
    });

    // This is what makes the damage permanent rather than merely wrong
    // once: a reference stranded inside the address follows a ")", which
    // the lint rule reads as a settled position, so no later lint pass
    // rescues it. True before and after any fix to the walk, so it stays
    // green either way.
    it("a reference stranded inside the address is then left there by lint", () => {
        const broken =
            "[linked](https://en.wikipedia.org/wiki/Ba_(disambiguation)[^k]#h).";
        expect(footnoteAfterPunctuation(broken)).toBe(broken);
    });

    // The control: an address with no brackets of its own is handled
    // correctly today, by both the walk and the lint rule.
    it("a plain link address is stepped over whole (control)", () => {
        const line = "see [bravo](https://theindex.moe) here.";
        expect(referenceLandingAfter(line, line.indexOf("]"))).toBe(
            line.indexOf(")") + 1,
        );
        expect(
            footnoteAfterPunctuation("[linked[^k]](https://theindex.moe)."),
        ).toBe("[linked](https://theindex.moe).[^k]");
    });
});
