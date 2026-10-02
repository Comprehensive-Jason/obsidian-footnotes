import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// spec question: in Chinese, where "**" sits between two characters with no
// spaces, should a press inside the bold text land after the closing "**"?
//
// What it does now: in "这是**重点**内容" with the caret in "重点", the press
// gives "这是**重点[^1]**内容": the reference lands inside the bold. The
// landing walk reads the second "**" as an opener because a character
// follows it directly.
// What a user might expect: "这是**重点**[^1]内容", with the reference after
// the bold, as an English "**word** x" gets.
// Why it is a question and not a bug: a "**" with characters on both
// sides can open or close, depending on an earlier "**", so the walk
// cannot tell from the mark alone. micromark loses the bold altogether
// in this shape (it shows the asterisks), so the "right" landing depends
// on how Obsidian itself renders it, which has not been checked.
//
// Hunt 2026-10-02, round 2, lens placement. Cluster L4.
//
// Source of truth: the README's placement setting (a closing mark is
// stepped over) and FootnotePlacement's docblock.

describe("spec question: CJK emphasis closer glued to the next character", () => {
    it.fails("after: 这是**重点**内容, caret in 重点, lands after the closing **", async () => {
        const doc = fakeEditor(["这是**重点**内容"], { cursor: { line: 0, ch: 4 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(
            fakePlugin(
                {
                    insertAtEndOfWord: true,
                    footnotePlacement: "after",
                    enablePopupEditor: false,
                    enableFootnotePrefix: false,
                    enableFootnoteSectionHeading: false,
                },
                doc,
            ),
        );
        expect(doc.lines[0]).toBe("这是**重点**[^1]内容");
    });
});
