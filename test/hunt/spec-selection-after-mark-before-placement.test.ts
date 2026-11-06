import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { selectionPressHandled } from "../../src/commands/selection-footnote";
import type { TableCellEditor } from "../../src/editor/table-cursor";
import { lintNote } from "../../src/linting/linter";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import type { FootnotePlacement } from "../../src/parsing/landing";

// SPEC (annoyance): under Before, selecting the words after a comma or a full
// stop and pressing left the reference right after that mark, "A word. |More|"
// gave "A word.[^1]", and the next lint moved it in front, "A word[^1].". The
// selection took the space in front of it (Jason's attach ruling of
// 2026-09-08) and stopped at the mark; a press there hops back over it.
//
// What the user sees now: "A word[^1]." at once, in the note and in a table
// cell, with the numbered, named, and inline keys alike, so a press and a
// lint agree. An abbreviation's own dot is not hopped: "the U.S. |Senate|"
// still gives "the U.S.[^1]".
//
// Hunt 2026-11-06, cycle 9, finding H39 (H21 is the same question). Source
// of truth: the triage's choice for Jason, 2026-11-06 ("it hops back as the
// press does"); the hop-back ruling of 2026-11-05; commit 0a3ffdc, "a lint
// never moves what was just placed". Severity: annoyance. Origin:
// pre-existing.

const Settings = { insertAtEndOfWord: true, expandSelectionToWholeWords: true, enablePopupEditor: false, enableFootnotePrefix: false, enableFootnoteSectionHeading: false, lintOnFootnoteCreation: false, lintFixPunctuation: true };

/** Converts the text between the two "|" of `marked` with the numbered or inline key: the note's lines afterwards, and the plugin. */
function convert(marked: string, footnotePlacement: FootnotePlacement, command: "autonum" | "inline" = "autonum") {
    const anchor = marked.indexOf("|");
    const head = marked.indexOf("|", anchor + 1) - 1;
    const text = marked.replaceAll("|", "");
    const doc = fakeEditor([text], { selection: { anchor: { line: 0, ch: anchor }, head: { line: 0, ch: head } }, edits: true, wholeDoc: true, words: true });
    const plugin = fakePlugin({ ...Settings, footnotePlacement }, doc);
    selectionPressHandled(plugin, doc, null, command);
    return { lines: doc.lines, plugin };
}

/** Converts the text between the two "|" of `marked` in a table cell's own editor: the edit the cell receives. */
function convertInCell(marked: string, footnotePlacement: FootnotePlacement, command: "autonum" | "inline") {
    const anchor = marked.indexOf("|");
    const head = marked.indexOf("|", anchor + 1) - 1;
    const text = marked.replaceAll("|", "");
    const dispatched: unknown[] = [];
    const cell: TableCellEditor = {
        state: { doc: { toString: () => text }, selection: { main: { head, anchor } } },
        dispatch: (spec) => {
            dispatched.push(spec);
        },
    };
    const doc = fakeEditor([`| ${text} |`, "| --- |", "| x |"], { cursor: { line: 0, ch: 2 }, edits: true, wholeDoc: true, words: true });
    selectionPressHandled(fakePlugin({ ...Settings, footnotePlacement }, doc), doc, cell, command);
    return (dispatched[0] as { changes: { from: number; to: number; insert: string } }).changes;
}

beforeEach(resetNotices);

describe("Before: a selection after a mark puts the reference in front of the mark", () => {
    it.each([
        ["A word. |More|", ["A word[^1].", "", "[^1]: More"]],
        ["A word, |more|", ["A word[^1],", "", "[^1]: more"]],
        ["A claim, |word|.", ["A claim[^1],.", "", "[^1]: word"]],
        ["Yes, |really|!", ["Yes[^1],!", "", "[^1]: really"]],
        ["这是。|句子|", ["这是[^1]。", "", "[^1]: 句子"]],
        ["Vraiment ? |Oui|", ["Vraiment[^1] ?", "", "[^1]: Oui"]],
        ["A word.  |More|", ["A word[^1].", "", "[^1]: More"]],
        // an abbreviation's own dot keeps the reference behind it
        ["the U.S. |Senate|", ["the U.S.[^1]", "", "[^1]: Senate"]],
        ["apples, |etc|.", ["apples[^1],", "", "[^1]: etc."]],
        // a closing mark after the stop is stepped over, as the press steps over it
        ['He said "no." |Then|', ['He said "no."[^1]', "", "[^1]: Then"]],
        // nothing to hop over: as before
        ["A word |more|", ["A word[^1]", "", "[^1]: more"]],
        ["|A word|.", ["[^1].", "", "[^1]: A word"]],
    ])("%s gives %s, and the lint leaves it", (marked, expected) => {
        const { lines, plugin } = convert(marked, "before");
        expect(lines).toEqual(expected);
        expect(lintNote(plugin, lines.join("\n"), "")).toBe(lines.join("\n"));
    });

    it("the inline key lands the same way", () => {
        expect(convert("A word. |More|", "before", "inline").lines).toEqual(["A word^[More]."]);
        expect(convert("the U.S. |Senate|", "before", "inline").lines).toEqual(["the U.S.^[Senate]"]);
        const written = convert("A word. |More|", "before", "inline").lines.join("\n");
        expect(footnoteAfterPunctuation(written, "before")).toBe(written);
    });

    it("in a table cell, the numbered and inline keys land the same way", () => {
        expect(convertInCell("A word. |More|", "before", "autonum")).toEqual({ from: 6, to: 12, insert: "[^1]." });
        expect(convertInCell("A word. |More|", "before", "inline")).toEqual({ from: 6, to: 12, insert: "^[More]." });
        expect(convertInCell("the U.S. |Senate|", "before", "autonum")).toEqual({ from: 8, to: 15, insert: "[^1]" });
    });

    it("controls: After and Don't move keep the reference after the mark", () => {
        expect(convert("A word. |More|", "after").lines).toEqual(["A word.[^1]", "", "[^1]: More"]);
        expect(convert("A word. |More|", "none").lines).toEqual(["A word.[^1]", "", "[^1]: More"]);
        expect(convertInCell("A word. |More|", "after", "autonum")).toEqual({ from: 7, to: 12, insert: "[^1]" });
    });
});
