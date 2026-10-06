import { beforeEach, describe, expect, it } from "vitest";

import { insertInTableCell } from "../../src/commands/create-footnote";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import type { TableCellEditor } from "../../src/editor/table-cursor";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { readNote } from "../../src/parsing/note-reading";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// BUG (wrong output): a "!" in front of bracketed text that is no image is
// treated as an image's "!", so a footnote placed "after punctuation" stops
// in front of it.
//
// What the user would see: with footnote placement set to after
// punctuation, a numbered press at the end of "Wow" in "Wow![x] more"
// (the note has no "[x]: ..." line) writes "Wow[^1]![x] more", with the
// footnote number before the exclamation mark. The lint leaves
// "Wow[^1]![x]" as it is, splits "!!" in "Wow[^1]!![citation needed]" into
// "Wow![^1]![citation needed]", a selection of "Wo" turns into a footnote
// whose text is "Wow" without its "!", and the same press in a table cell
// writes the footnote before the "!".
//
// An "image" here is "![alt](pic.png)", or "![x]" when the note has a line
// "[x]: pic.png" that tells Obsidian where the picture is. Without that
// line, "![x]" is plain text: an exclamation mark and "[x]".
//
// Hunt 2026-10-06, cycle 4, lens press. Cluster P1.
//
// Origin: regression (since ea38e82, from 56fa47b).
//
// Source of truth: CommonMark 6.3 and 6.4 (a bracketed label with no
// matching "[x]:" line is no link and no image, so the text shows as
// written), the plugin's own drawnAsLink in src/parsing/landing.ts (which
// asks exactly that), and live Obsidian 1.14.4: "Wow![^1][x] more" with
// "[^1]: n" and no "[x]:" line reads [^1] as a live reference.
//
// Cause: punctuationAt in src/parsing/landing.ts (56fa47b) says no to
// every "!" right in front of a "[" that does not start "[^", without
// asking whether the note draws that bracketed text as an image. Every
// walk (the press, the lint, the selection expansion, the table cell
// press) asks punctuationAt, so all of them stop in front of the "!".

beforeEach(resetNotices);

const After = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    expandSelectionToWholeWords: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

/** The names of the live references on one line of the note. */
function liveReferences(lines: string[], line = 0): string[] {
    return readNote(lines).referencesOn(line).map((o) => o.name);
}

describe("'!' before bracketed text that is no image", () => {
    // Now: "Wow[^1]![x] more".
    it.fails("press at the end of 'Wow' in 'Wow![x] more' (no [x]: line) lands after the '!'", async () => {
        const doc = fakeEditor(["Wow![x] more"], { cursor: { line: 0, ch: 1 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(After, doc));
        expect(doc.lines[0]).toBe("Wow![^1][x] more");
        expect(liveReferences(doc.lines)).toEqual(["1"]);
    });

    // Now: the line stays "Wow[^1]![x] more".
    it.fails("lint (after): 'Wow[^1]![x] more' moves the reference past the '!'", () => {
        const out = footnoteAfterPunctuation("Wow[^1]![x] more\n\n[^1]: a", "after");
        expect(out.split("\n")[0]).toBe("Wow![^1][x] more");
    });

    // Now: "Wow![^1]![citation needed] more".
    it.fails("lint (after): 'Wow[^1]!![citation needed] more' does not split the '!!'", () => {
        const out = footnoteAfterPunctuation("Wow[^1]!![citation needed] more\n\n[^1]: a", "after");
        expect(out.split("\n")[0]).toBe("Wow!![^1][citation needed] more");
    });

    // Now: the footnote's text is "Wow" and the "!" stays behind.
    it.fails("selection 'Wo' of 'Wow![x] more' expands to 'Wow!' under after", async () => {
        const doc = fakeEditor(["Wow![x] more"], {
            cursor: { line: 0, ch: 2 },
            selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 2 } },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(After, doc));
        expect(doc.lines).toContain("[^1]: Wow!");
    });
});

describe("'!' before bracketed text that is no image, table cell face", () => {
    // A table cell is edited in its own small editor; this stands in for
    // it and records where the press writes. Now: at offset 3, before the
    // "!".
    it.fails("cell press at the end of 'Wow' in 'Wow![x] more' lands after the '!'", () => {
        const dispatched: { changes?: { from: number } }[] = [];
        const cell = {
            state: { doc: { toString: () => "Wow![x] more" }, selection: { main: { head: 1, anchor: 1 } } },
            dispatch: (spec: { changes?: { from: number } }) => dispatched.push(spec),
        } as unknown as TableCellEditor;
        insertInTableCell(cell, fakePlugin({ insertAtEndOfWord: true, footnotePlacement: "after" }), "[^1]", 4);
        expect(dispatched[0]?.changes?.from).toBe(4);
    });
});
