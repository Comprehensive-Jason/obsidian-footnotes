import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (annoyance): with "insert at end of word" on, a press on a word of
// link text is refused when the link's title or <destination> holds a ")".
//
// What the user would see: on '[some word](http://u "a)b") x' with the
// caret in "word", nothing is written and the toast says "No footnote was
// created: Obsidian would read it as part of a link.", though the same
// press on a link whose title holds no ")" puts the reference after the
// link (control below).
//
// Hunt 2026-10-05, round 1, lens regressions. Cluster RG3 (a harder variant
// of the fixed pin bug-landing-link-balanced-parens).
//
// Source of truth: the control's own behaviour; referenceLandingAfter's
// contract (a markdown link's "(url)" tail right after a "]" is stepped
// over whole, so the reference never splits [text](url)); CommonMark lets
// a link title and a <...> destination hold ")", and the plugin's reader
// reads each of these as one link ending at its last ")".
//
// Cause: balancedParenEnd in src/parsing/landing.ts counts every "(" and
// ")" and skips only backslash escapes, so it stops at the ")" inside the
// quoted title or the <...> destination and the reference lands inside the
// link.

const SETTINGS = {
    enablePopupEditor: false,
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

/** A numbered press with the caret at `ch` of the one-line note `line`. */
async function press(line: string, ch: number) {
    const doc = fakeEditor([line], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(SETTINGS, doc));
    return doc;
}

beforeEach(() => {
    resetNotices();
});

describe("landing after a link whose title or <destination> holds a ')'", () => {
    it("control: a titled link with no ')' in its title takes the reference after the link", async () => {
        const doc = await press('[some word](http://u "ab") x', 8);
        expect(doc.lines[0]).toBe('[some word](http://u "ab")[^1] x');
    });

    it.fails("a ')' inside the quoted title", async () => {
        const doc = await press('[some word](http://u "a)b") x', 8);
        expect(messages()).toEqual([]);
        expect(doc.lines[0]).toBe('[some word](http://u "a)b")[^1] x');
    });

    it.fails("a ')' inside an angle-bracketed destination", async () => {
        const doc = await press("[some word](<a)b>) x", 8);
        expect(messages()).toEqual([]);
        expect(doc.lines[0]).toBe("[some word](<a)b>)[^1] x");
    });
});
