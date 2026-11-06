import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertInTableCell } from "../../src/commands/create-footnote";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import type { TableCellEditor } from "../../src/editor/table-cursor";
import type { FootnotePlacement } from "../../src/parsing/landing";

// Jason's ruling, 2026-11-05: with footnote placement "before", a press with
// the caret right after a word's punctuation puts the reference in front of it.
// It is the mirror of "after", where a caret just before the punctuation hops
// past it. Typing "这是句子。" and pressing the footnote key gives "这是句子[^1]。",
// and "A word." gives "A word[^1].". Before the ruling the reference landed
// after the punctuation, against the setting, until the next lint moved it.
//
// Hunt 2026-10-02, round 2, lens placement. Cluster L5.

// Presses the numbered-footnote key with the caret at `ch` on a one-line note, placement "before".
async function press(line: string, ch: number, footnotePlacement: FootnotePlacement = "before", insertAtEndOfWord = true) {
    const doc = fakeEditor([line], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(
        fakePlugin(
            {
                insertAtEndOfWord,
                footnotePlacement,
                enablePopupEditor: false,
                enableFootnotePrefix: false,
                enableFootnoteSectionHeading: false,
            },
            doc,
        ),
    );
    return doc.lines[0];
}

/** Presses with the caret where "|" stands in `marked`. */
const pressAt = (marked: string, footnotePlacement?: FootnotePlacement, insertAtEndOfWord?: boolean) =>
    press(marked.replace("|", ""), marked.indexOf("|"), footnotePlacement, insertAtEndOfWord);

describe("before, caret right after a word's punctuation (ruling 2026-11-05)", () => {
    it("这是句子。| then press lands in front of 。", async () => {
        expect(await press("这是句子。", 5)).toBe("这是句子[^1]。");
    });

    it("A word.| then press lands in front of the period", async () => {
        expect(await press("A word.", 7)).toBe("A word[^1].");
    });

    // Each row: the caret, and where the reference lands.
    for (const [marked, expected] of [
        // mid-sentence, a run, in the middle of a run
        ["One word.| Then more.", "One word[^1]. Then more."],
        ["wait...| what", "wait[^1]... what"],
        ["wait.|.. what", "wait[^1]... what"],
        // after a closing mark and the punctuation behind it, as a press in the word lands
        ['say "hello".| next', 'say "hello"[^1]. next'],
        ["**bold**.| next", "**bold**[^1]. next"],
        ["see [x](http://a.b/c).| next", "see [x](http://a.b/c)[^1]. next"],
        ["see [[note]].| next", "see [[note]][^1]. next"],
        // a closing mark after the caret is still stepped over, so the reference lands outside the quote
        ['"quoted.|" next', '"quoted."[^1] next'],
        ["「句子。|」然后", "「句子。」[^1]然后"],
        // the spaces in front of the punctuation stay with it, as the lint leaves them
        ["Vraiment ?|", "Vraiment[^1] ?"],
        ["Vraiment\u00a0?|", "Vraiment[^1]\u00a0?"],
        // in a list item
        ["- An item.|", "- An item[^1]."],
        // an email address, the case that hopped back already (ruling Q30, 2026-10-08)
        ["Write to me@example.com.|", "Write to me@example.com[^1]."],
    ] as const) {
        it(`${marked} gives ${expected}`, async () => {
            expect(await pressAt(marked)).toBe(expected);
        });
    }
});

describe("before, where the caret stays", () => {
    for (const [marked, expected, why] of [
        ['"quoted."|', '"quoted."[^1]', "a closing mark touches the caret, and the reference belongs outside it"],
        ["A word. |", "A word. [^1]", "a space touches the caret"],
        ["[see p. 5].|", "[see p. 5].[^1]", 'in front of the period "[see p. 5][^1]" would read as a link, and the press would be refused'],
        ["Version 2\\.|", "Version 2\\.[^1]", "an escaped period is a character of the word"],
        ["...|", "...[^1]", "no text stands in front of the punctuation"],
        ["  ...|", "  ...[^1]", "only spaces stand in front of the punctuation"],
        ["- ...|", "- ...[^1]", "only the list marker stands in front of the punctuation"],
    ] as const) {
        it(`${marked} gives ${expected}: ${why}`, async () => {
            expect(await pressAt(marked)).toBe(expected);
        });
    }
});

describe("controls: the other settings do not hop back", () => {
    it("after: the reference stays after the punctuation", async () => {
        expect(await pressAt("A word.|", "after")).toBe("A word.[^1]");
    });

    it("don't move: the reference stays where the caret is", async () => {
        expect(await pressAt("A word.|", "none")).toBe("A word.[^1]");
    });

    it("before, with Insert at end of word off: the reference stays where the caret is", async () => {
        expect(await pressAt("A word.|", "before", false)).toBe("A word.[^1]");
    });
});

describe("in a table cell (ruling 2026-11-05)", () => {
    // Presses the numbered key in a cell holding `text`, and hands back the text of the edit the cell received.
    function cellPress(text: string, caret: number, footnotePlacement: FootnotePlacement) {
        const inserted: { from: number; insert: string }[] = [];
        const cell: TableCellEditor = {
            state: { doc: { toString: () => text }, selection: { main: { anchor: caret, head: caret } } },
            dispatch: (spec) => {
                const changes = spec.changes as { from: number; insert: string };
                inserted.push(changes);
            },
        };
        insertInTableCell(cell, fakePlugin({ insertAtEndOfWord: true, footnotePlacement }), "[^1]", 4);
        return inserted[0]?.from;
    }

    it("before: hops back in front of the period", () => {
        expect(cellPress("A word.", 7, "before")).toBe(6);
    });

    it("control: after stays after the period", () => {
        expect(cellPress("A word.", 7, "after")).toBe(7);
    });
});
