import type { Editor, EditorChange, EditorPosition } from "obsidian";
import { describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import type FootnotePlugin from "../../src/main";
import { resolveTableCellCursor, type TableCellEditor } from "../../src/editor/table-cursor";

// BUG (wrong output): in a table cell that holds a literal escaped
// backslash, written "\\" in the note, every caret after it is read one
// column too far right, and a press just inside a reference nests a new
// reference inside it.
//
// What the user would see: the cell reads "left \\ [^note]". With the
// caret between the "e" of "note" and its "]", the numbered hotkey should
// treat the caret as inside the reference and add the missing definition.
// Instead it writes a new reference there, and the cell ends up holding
// "[^note[^1]]".
//
// Needs a live check: this is a bug only if Obsidian's table cell editor
// shows a literal "\\" as both of its characters. The plugin's own comment
// says the cell editor unescapes only the pipe ("\|" shows as "|"), which
// is what the tests below assume, but it has not been checked in the live
// app for a double backslash.
//
// Hunt 2026-10-02, round 3, lens gram-off. Cluster G6. The same family as
// bug-table-escape-offset (an escaped pipe).
//
// Source of truth: the comment in resolveTableCellCursor ("the cell editor
// shows "\|" as a plain "|""), and the press's rule that a caret just
// inside a reference navigates rather than nesting (ADR 0001: no nesting).
//
// Cause: the escape walk in resolveTableCellCursor
// (src/editor/table-cursor.ts) treats ANY backslash followed by the next
// character the cell shows as a hidden escape. For "\\", the cell shows a
// backslash next, so the walk swallows both source backslashes for one
// shown character and lands one column further on from then on.
//
// Live check settled from Obsidian's own code (2026-10-06): the cell
// editor's source-to-cell conversion in Obsidian's app.js changes only an
// escaped pipe (the last backslash of an odd run in front of a "|") and a
// "<br>" outside inline code; every other backslash shows as itself, so
// "\\" is two characters in the cell, as the tests below assume.
//
// Fix (2026-10-06): rawCellColumn in src/editor/table-cursor.ts walks the
// raw cell by that conversion, not by comparing with the cell's text.

/** resolveTableCellCursor for a one-cell body row: the source line, the text the cell editor shows, and the caret inside that text. */
function resolve(lineText: string, cellText: string, head: number): ReturnType<typeof resolveTableCellCursor> {
    const bodyRow = {};
    const table = { rows: [{}, bodyRow] as unknown[] };
    const td = { cellIndex: 0 };
    const active = {
        closest(selector: string) {
            if (selector === "td, th") return td;
            if (selector === "table") return table;
            if (selector === "tr") return bodyRow;
            return null;
        },
    };
    const cellView: TableCellEditor = {
        state: { doc: { toString: () => cellText }, selection: { main: { head, anchor: head } } },
        dispatch() {},
    };
    class MainView {
        static findFromDOM() {
            return cellView;
        }
        contentDOM = { ownerDocument: { activeElement: active }, contains: () => true };
        posAtDOM = () => 100;
    }
    const editor = {
        cm: new MainView(),
        offsetToPos: () => ({ line: 5, ch: 0 }),
        lastLine: () => 20,
        getLine: () => lineText,
    } as unknown as Editor;
    return resolveTableCellCursor(editor);
}

describe("a cell holding a literal escaped backslash", () => {
    it("a caret just inside the reference maps just inside it in the row", () => {
        // the row in the note: | a\\b [^1] |   (two backslash characters)
        const line = "| a\\\\b [^1] |";
        const cellText = "a\\\\b [^1]";
        const head = cellText.indexOf("[^") + 1;
        // Today: 9, one column too far
        expect(resolve(line, cellText, head)?.ch).toBe(line.indexOf("[^") + 1);
    });

    // Found while fixing (2026-10-06): the cell editor shows a "<br>" as a
    // line break, one character for four (Obsidian's source-to-cell
    // conversion in app.js), so the walk counted three columns short after
    // one. A "<br>" inside inline code stays as it is.
    it("a caret after a '<br>' maps past all four of its characters", () => {
        const line = "| a<br>b [^1] |";
        const cellText = "a\nb [^1]";
        const head = cellText.indexOf("[^") + 1;
        // Before the fix: 6, three columns short
        expect(resolve(line, cellText, head)?.ch).toBe(line.indexOf("[^") + 1);
    });

    it("control: a '<br>' inside inline code is four characters in the cell too", () => {
        const line = "| `a<br>b` [^1] |";
        const cellText = "`a<br>b` [^1]";
        const head = cellText.indexOf("[^") + 1;
        expect(resolve(line, cellText, head)?.ch).toBe(line.indexOf("[^") + 1);
    });

    it("control: an escaped pipe after an escaped backslash still hides its backslash", () => {
        // the row: | a\\\|b [^1] |   (three backslashes: an escaped
        // backslash, then an escaped pipe); the cell shows a\\|b [^1]
        const line = "| a\\\\\\|b [^1] |";
        const cellText = "a\\\\|b [^1]";
        const head = cellText.indexOf("[^") + 1;
        expect(resolve(line, cellText, head)?.ch).toBe(line.indexOf("[^") + 1);
    });

    it("a numbered press just inside a reference after a literal '\\\\' does not nest a new reference", async () => {
        const lines = ["| Header |", "| --- |", "| left \\\\ [^note] |"];
        const shown = "left \\\\ [^note]";
        const head = shown.indexOf("]"); // between "e" and "]": inside the reference
        const table = { rows: [{}, {}] as unknown[] };
        const bodyRow = table.rows[1];
        const td = { cellIndex: 0 };
        const active = {
            closest(selector: string) {
                if (selector === "td, th") return td;
                if (selector === "table") return table;
                if (selector === "tr") return bodyRow;
                return null;
            },
        };
        const cellChanges: unknown[] = [];
        const cellView: TableCellEditor = {
            state: { doc: { toString: () => shown }, selection: { main: { head, anchor: head } } },
            dispatch(spec) {
                cellChanges.push(spec);
            },
        };
        class MainView {
            static findFromDOM() {
                return cellView;
            }
            contentDOM = { ownerDocument: { activeElement: active }, contains: () => true };
            posAtDOM = () => 0;
            focus() {}
        }
        const appliedChanges: EditorChange[] = [];
        const doc = {
            cm: new MainView(),
            getCursor: () => ({ line: 0, ch: 0 }),
            getLine: (line: number) => lines[line],
            getValue: () => lines.join("\n"),
            lineCount: () => lines.length,
            lastLine: () => lines.length - 1,
            offsetToPos: () => ({ line: 0, ch: 0 }),
            setCursor() {},
            scrollIntoView() {},
            transaction(spec: { changes?: EditorChange[]; selection?: { from: EditorPosition } }) {
                if (spec.changes) appliedChanges.push(...spec.changes);
            },
        } as unknown as Editor;
        const plugin = {
            app: { workspace: { getActiveViewOfType: () => ({ editor: doc }) }, vault: {} },
            settings: {
                insertAtEndOfWord: false,
                enablePopupEditor: false,
                enableFootnotePrefix: false,
                enableFootnoteSectionHeading: false,
                footnoteSectionHeading: "",
                enableRemoveBlankLastLines: true,
                lintOnFootnoteCreation: false,
            },
        } as unknown as FootnotePlugin;

        await insertAutonumFootnote(plugin);

        // As in bug-table-escape-offset's press test: the press navigates
        // (here it adds the missing definition) and never writes the cell.
        // Today: the cell is written once, nesting a new reference
        expect(cellChanges).toEqual([]);
        expect(appliedChanges.map((change) => change.text)).toEqual(["\n\n[^note]: "]);
    });
});
