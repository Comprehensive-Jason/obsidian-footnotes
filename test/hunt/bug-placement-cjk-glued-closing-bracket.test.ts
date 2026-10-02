import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { FootnotePlacement } from "../../src/parsing/markdown-scan";

// BUG (wrong output): a CJK closing bracket or quote glued to the next
// character is read as an opening mark, so the reference stays inside it.
//
// What the user would see: Chinese and Japanese have no spaces, so a
// closing mark almost always touches the next character. Pressing the
// footnote key with the caret in "来源" of "他说（来源）然后" gives
// "他说（来源[^1]）然后" instead of "他说（来源）[^1]然后". The lint leaves
// "他说「来源[^1]」然后" as it is instead of moving the reference out past
// the "」". "彼は「出典」と言った" in Japanese behaves the same.
//
// Hunt 2026-10-02, round 2, lens placement. Cluster L3.
//
// Source of truth: the README's placement setting ("a closing quotation
// mark or bracket is always stepped over, since every convention puts the
// marker outside the quote"), the rule's README entry ("Moves references
// that sit inside closing quotation marks, brackets ... out past them"),
// manual sheet 16's quoted Chinese check (lands after the "」"), and
// FootnotePlacement's docblock.
//
// Cause: referenceLandingAfter treats "a mark glued to a word character on
// its far side" as an opener, not a closer (b32cbd5, written for
// "[^1]*important*" and "Marx's"). That test also fires on "」", "）",
// "』", "】" and "》", which can only ever close.

// Presses the numbered-footnote key with the caret at `ch` on a one-line note.
async function press(line: string, ch: number, placement: FootnotePlacement) {
    const doc = fakeEditor([line], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(
        fakePlugin(
            {
                insertAtEndOfWord: true,
                footnotePlacement: placement,
                enablePopupEditor: false,
                enableFootnotePrefix: false,
                enableFootnoteSectionHeading: false,
            },
            doc,
        ),
    );
    return doc.lines[0];
}

describe("CJK closing brackets glued to the next character are still closers", () => {
    it.fails("lint after: a reference inside a glued 」 moves out", () => {
        expect(footnoteAfterPunctuation("他说「来源[^1]」然后", "after")).toBe("他说「来源」[^1]然后");
    });

    it.fails("after: 他说（来源）然后, caret in 来源, lands after the ）", async () => {
        expect(await press("他说（来源）然后", 3, "after")).toBe("他说（来源）[^1]然后");
    });
});
