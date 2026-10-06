import { beforeEach, describe, expect, it } from "vitest";

import { insertInTableCell } from "../../src/commands/create-footnote";
import type { TableCellEditor } from "../../src/editor/table-cursor";
import { cellLinkLikeEndAt } from "../../src/parsing/landing";
import { resetNotices } from "../helpers/notices";
import { fakePlugin } from "../helpers/fake-plugin";

// BUG (wrong output): in a table cell, a press inside a wikilink with an
// alias (or an embed with a size) writes the footnote inside the link.
//
// What the user would see: a table cell holds "see [[Page|alias text]]
// now" (the note stores it as "[[Page\|alias text]]", since a table needs
// its pipe escaped). With the caret in "alias", the numbered key writes
// "[[Page|alias[^1] text]]": the reference lands at the end of the word,
// inside the wikilink. Nothing inside a wikilink is read, so
// the new reference is dead and its new definition is orphaned on
// arrival. An embed with a size, "![[img.png|200]]", does the same. A
// wikilink with no alias in a cell, and the same row in the main editor,
// land after the "]]" as they should.
//
// Hunt 2026-10-05, round 2, lens press. Cluster P1.
//
// Source of truth: rule D1 in docs/obsidian-reading-rules.md (nothing is
// read inside a wikilink); Jason's landing rulings of 2026-09-15 (a
// reference never splits a wikilink); Obsidian's own table cell editor
// (app.js, the functions gy and vy) shows "\|" in a cell as a plain "|".
//
// Cause: cellLinkLikeEndAt in src/parsing/landing.ts reads the cell's
// text as the one cell of a one-row table, "| text |". The cell editor
// has already turned "\|" into "|", so that bare pipe splits the
// pretend cell in two, and no wikilink is found. A regression from
// c6ee2fa: before it, linkLikeEndAt's wikilink pattern matched
// "[[Page|alias]]" whole.

function cell(text: string, head: number) {
    const dispatched: { changes?: { from: number; to?: number; insert: string } }[] = [];
    const editor: TableCellEditor = {
        state: { doc: { toString: () => text }, selection: { main: { head, anchor: head } } },
        dispatch: (spec) => {
            dispatched.push(spec);
        },
    };
    return { editor, dispatched };
}

const Plugin = () => fakePlugin({ insertAtEndOfWord: true, footnotePlacement: "after" });

beforeEach(resetNotices);

describe("a wikilink with an alias inside a table cell's editor", () => {
    it.fails("cellLinkLikeEndAt finds the end of '[[Page|alias text]]' as the cell editor shows it", () => {
        const shown = "see [[Page|alias text]]";
        // Today: -1, no link found.
        expect(cellLinkLikeEndAt(shown, shown.indexOf("alias") + 2)).toBe(shown.length);
    });

    it.fails("the numbered press lands after the wikilink, not inside its alias", () => {
        const shown = "see [[Page|alias text]] now";
        const { editor, dispatched } = cell(shown, shown.indexOf("alias") + 2);
        insertInTableCell(editor, Plugin(), "[^1]", 4);
        // Today: inserted at the end of "alias", inside the wikilink.
        expect(dispatched[0]?.changes?.from).toBe("see [[Page|alias text]]".length);
    });

    it.fails("an embed with a size: the press lands after it", () => {
        const shown = "![[img.png|200]] caption";
        const { editor, dispatched } = cell(shown, 4);
        insertInTableCell(editor, Plugin(), "[^1]", 4);
        expect(dispatched[0]?.changes?.from).toBe("![[img.png|200]]".length);
    });
});
