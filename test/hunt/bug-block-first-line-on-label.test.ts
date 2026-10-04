import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { TableSelectionNotice } from "../../src/commands/selection-footnote";
import { lintFootnotes } from "../../src/linting/linter";
import { orphanedFootnoteReferenceNames } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// Jason's manual pass, sheets 04 and 05 (2026-09-09).
//
// Sheet 04: selecting a fenced code block on its own and converting it put
// the fence's opening "```" on the definition's label line: "[^6]: ```".
// To Obsidian that is the literal text "```", so the fence's CLOSER on the
// indented line below opened a fence of its own that ran to the end of the
// note. The creation lint then saw every definition below as code: "[^d]"
// became an orphan, the popup waited for an index that never came, and the
// caret landed on the wrong footnote.
//
// Sheet 05: a table selected exactly (or with the blank lines around it)
// was refused, on the belief that a table cannot begin on the label line.
// Jason's ruling: it should convert, since a bare table inside a footnote
// definition renders fine - and Obsidian renders "[^1]: | a | b |" with
// the rows indented below it as a table.
//
// Only a fence needs the special shape: it starts on the line AFTER the
// label, indented with the rest, because the scanner does not read a
// fence opener that sits after a label. Every other block construct -
// heading, table row, list item, quote, rule, math - renders on the label
// line in Obsidian (checked 2026-09-09/10) and stays there (Jason,
// 2026-09-10: the empty label line read as a stray blank line).

function fakeEditor(
    lines: string[],
    anchor: EditorPosition,
    head: EditorPosition,
): FakeEditor {
    return sharedFakeEditor(lines, {
        cursor: anchor,
        selection: { anchor, head },
        edits: true,
        wholeDoc: true,
    });
}

function fakePlugin(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
        },
        doc,
    );
}

const blocksOf = (lines: string[]) =>
    readNote(lines).blocks.map((b) => `${b.name}@${b.start}-${b.end}`);

describe("a selection whose first line is a block construct", () => {
    beforeEach(resetNotices);

    it("a fenced code block selected on its own: the fence starts under an empty label line", async () => {
        const lines = ["intro[^d] here.", "", "```", "select me in here", "```", "", "[^d]: d body"];
        const doc = fakeEditor(lines, { line: 2, ch: 0 }, { line: 4, ch: 3 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual([
            "intro[^d] here.",
            "",
            "[^1]",
            "",
            "[^d]: d body",
            "[^1]: ",
            "    ```",
            "    select me in here",
            "    ```",
        ]);
        // the fence is definition content, not an unclosed fence that eats the note
        expect(blocksOf(doc.lines)).toEqual(["d@4-4", "1@5-8"]);
        // and the creation lint that follows keeps every footnote alive
        const linted = lintFootnotes(doc.lines.join("\n"));
        expect(orphanedFootnoteReferenceNames(linted)).toEqual([]);
        expect(linted).toContain("    select me in here");
    });

    it("a heading first, a list first, a quote first, a rule first: all on the label line", async () => {
        for (const [middle, expectedBody] of [
            [["## Title", "text under it"], ["[^1]: ## Title", "    text under it"]],
            [["- item one", "- item two"], ["[^1]: - item one", "    - item two"]],
            [["> quoted", "> more"], ["[^1]: > quoted", "    > more"]],
            [["---", "after the rule"], ["[^1]: ---", "    after the rule"]],
        ] as const) {
            const lines = ["above", "", ...middle, "", "tail"];
            const last = 1 + middle.length;
            const doc = fakeEditor(lines, { line: 2, ch: 0 }, { line: last, ch: lines[last].length });
            await insertAutonumFootnote(fakePlugin(doc));
            expect(doc.lines).toEqual(["above", "", "[^1]", "", "tail", "", ...expectedBody]);
        }
    });

    it("prose first still shares the label line (the existing contract)", async () => {
        const lines = ["above", "", "first line", "second line", "", "tail"];
        const doc = fakeEditor(lines, { line: 2, ch: 0 }, { line: 3, ch: "second line".length });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["above", "", "[^1]", "", "tail", "", "[^1]: first line", "    second line"]);
    });
});

describe("a table selected whole converts", () => {
    beforeEach(resetNotices);
    const table = ["before the table", "", "| a | b |", "| --- | --- |", "| one | two |", "", "after the table"];
    const converted = [
        "before the table",
        "",
        "[^1]",
        "",
        "after the table",
        "",
        "[^1]: | a | b |",
        "    | --- | --- |",
        "    | one | two |",
    ];

    it("exactly, edge to edge", async () => {
        const doc = fakeEditor(table, { line: 2, ch: 0 }, { line: 4, ch: "| one | two |".length });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(TableSelectionNotice)).toBe(false);
        expect(doc.lines).toEqual(converted);
    });

    it("with the blank lines around it", async () => {
        const doc = fakeEditor(table, { line: 1, ch: 0 }, { line: 5, ch: 0 });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(TableSelectionNotice)).toBe(false);
        expect(doc.lines).toEqual(converted);
    });

    it("a partial table is still refused", async () => {
        const doc = fakeEditor(table, { line: 2, ch: 0 }, { line: 3, ch: "| --- | --- |".length });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(TableSelectionNotice)).toBe(true);
        expect(doc.lines).toEqual(table);
    });
});
