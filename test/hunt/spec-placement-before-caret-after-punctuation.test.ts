import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// spec question: with footnote placement "before", should a press with the
// caret just after a word's punctuation put the reference in front of it?
//
// What it does now: typing "这是句子。" and pressing the footnote key gives
// "这是句子。[^1]", and "A word." gives "A word.[^1]": the reference lands
// after the punctuation, against the setting. The next lint moves it, but
// Lint on footnote creation is off by default.
// What a user might expect: "这是句子[^1]。" and "A word[^1].", the shape the
// setting names. Under "after", a caret just before the punctuation
// already hops past it, so the mirror image would hop back.
// Why it is a question and not a bug: the caret sits after the
// punctuation, and a press normally lands where the caret is, or at the
// end of the word the caret is in. Whether "type the sentence, then
// press" should follow the setting is Jason's call.
//
// Hunt 2026-10-02, round 2, lens placement. Cluster L5.
//
// Source of truth: the README's placement setting and manual sheet 16
// ("before" gives "句子[^1]。").

// Presses the numbered-footnote key with the caret at `ch` on a one-line note, placement "before".
async function press(line: string, ch: number) {
    const doc = fakeEditor([line], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(
        fakePlugin(
            {
                insertAtEndOfWord: true,
                footnotePlacement: "before",
                enablePopupEditor: false,
                enableFootnotePrefix: false,
                enableFootnoteSectionHeading: false,
            },
            doc,
        ),
    );
    return doc.lines[0];
}

describe("spec question: before, caret right after a word's punctuation", () => {
    it.fails("这是句子。| then press lands in front of 。", async () => {
        expect(await press("这是句子。", 5)).toBe("这是句子[^1]。");
    });

    it.fails("A word.| then press lands in front of the period", async () => {
        expect(await press("A word.", 7)).toBe("A word[^1].");
    });
});
