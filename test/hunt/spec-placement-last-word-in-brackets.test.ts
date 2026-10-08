import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes } from "../../src/linting/linter";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// spec question: under After or Before punctuation, should a press on the
// last word of bracketed text that is no link land inside the brackets, as
// Don't move does, instead of refusing?
//
// What it does now: "as noted [see p. 5] here" with the caret on "5" and
// the numbered key under After punctuation refuses with the link notice.
// The landing walk steps over the "]", which would give "[see p. 5][^1]",
// and Obsidian reads that as a reference link labelled "^1", so the
// born-dead check refuses. Under Don't move the same press gives "[see p.
// 5[^1]]", and on the first word every placement lands inside ("[some[^1]
// text]", pin bug-dont-move-bracketed-text). A caret right after the "]"
// (before a ".") refuses under every placement, though "[see p. 5].[^1]"
// (After) is live.
// What a user might expect: the footnote written inside the brackets,
// where it is live, as Don't move does.
// Why it is a question and not a bug: the README says "a closing quotation
// mark or bracket is always stepped over", and the refusal keeps the
// plugin from writing a footnote that would not work. Jason has not ruled
// on it (open since 2026-10-05).
//
// Options:
//   (a) land inside the brackets, as Don't move does (recommended: the
//       footnote is live there, and the press does what the user asked);
//   (b) keep the refusal.
// The tests below take option (a).
//
// Hunt 2026-10-06, cycle 3, lens press. Cluster P3.
//
// Origin: pre-existing (cec4352 does the same).
//
// Source of truth: the README's landing rules quoted above; live Obsidian
// 1.14.4 (2026-10-05): "[some text[^1]]" with no "[some text]:" line has a
// live reference; the Don't move behaviour (the control).

const settings = (placement: "after" | "before" | "none") => ({
    insertAtEndOfWord: true,
    footnotePlacement: placement,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
});

beforeEach(resetNotices);

/** Presses the numbered key with the caret at column `ch` of a one-line note, under the given placement. */
async function press(line: string, ch: number, placement: "after" | "before" | "none") {
    const doc = fakeEditor([line], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(settings(placement), doc));
    return doc;
}

// Answered (Jason's ruling Q2, option (a), 2026-10-07; stage 4 of the
// result gate design, 2026-10-08): the landing walk stops in front of the
// "]" of bracketed text that is no link when it would end glued to it, so
// the press lands inside the brackets. The three tests were it.fails until
// then.
describe("spec question: a press on the last word of bracketed text that is no link", () => {
    it("After: '[see p. 5]' with no punctuation after it lands inside the brackets", async () => {
        const doc = await press("as noted [see p. 5] here", "as noted [see p. ".length + 1, "after");
        expect(messages()).toEqual([]);
        expect(doc.lines[0]).toBe("as noted [see p. 5[^1]] here");
    });

    it("Before: the caret on the 5 of '[see p. 5].' is not refused", async () => {
        const doc = await press("[see p. 5].", "[see p. 5".length, "before");
        expect(messages()).toEqual([]);
        expect(doc.lines[0]).not.toBe("[see p. 5].");
        expect(doc.lines[0]).toBe("[see p. 5[^1]].");
    });

    it("After: 'see [some text] here.' with the caret in 'text' is not refused", async () => {
        const doc = await press("see [some text] here.", "see [some te".length, "after");
        expect(messages()).toEqual([]);
        expect(doc.lines[0]).not.toBe("see [some text] here.");
    });

    it("After: '[see p. 5].' lands after the period, where the reference is live", async () => {
        const doc = await press("[see p. 5].", "[see p. 5".length, "after");
        expect(doc.lines[0]).toBe("[see p. 5].[^1]");
    });

    it("After: a period inside the brackets stays in front of the reference", async () => {
        const doc = await press("as noted [see p. 5.] here", "as noted [see p. 5".length, "after");
        expect(doc.lines[0]).toBe("as noted [see p. 5.[^1]] here");
    });

    it("the lint leaves a reference inside the brackets where it is", () => {
        expect(lintFootnotes("as noted [see p. 5[^1]] here\n\n[^1]: one", { placement: "after" })).toBe("as noted [see p. 5[^1]] here\n\n[^1]: one");
    });

    it("control: a link's text still steps out past the whole link", async () => {
        const doc = await press("see [some text](https://x.org) here.", "see [some te".length, "after");
        expect(doc.lines[0]).toBe("see [some text](https://x.org)[^1] here.");
    });

    it("control: Don't move lands inside the brackets", async () => {
        const doc = await press("see [some text] here.", "see [some te".length, "none");
        expect(doc.lines[0]).toBe("see [some text[^1]] here.");
    });
});
