// A table cell's text, read the way it reads in the note. The cell editor
// holds a cell's own text only, so there is no note around it to read:
// the text is read as the one cell of a one-row table, which is exactly
// how it reads in the note (it moved here from markdown-scan.ts in step 4
// of the runtime swap, 2026-10-03, when the rest of that file went).

import { NoteReading, readNote } from "./note-reading";

/**
 * A table cell's text, read as the note holds it. The cell editor shows a
 * cell's text the way it renders, not the way the note stores it:
 * Obsidian's table editor turns each "\|" of the note into a plain "|" when
 * it opens a cell, and each "<br>" into a line break, and turns them back
 * when it writes the cell into the note (app.js, the functions gy and vy).
 * Read as it is shown, a plain "|" would end the cell, so "[[Page|alias]]"
 * stopped being a wikilink and a press inside the alias split it (hunt
 * 2026-10-05, round 2, pin bug-cell-alias-wikilink-press). So the text is
 * written back the way the table editor writes it, and then read.
 *
 * Writing it back moves the columns on, so `column` and `offset` turn a
 * position in the cell's text into a column of the reading and back.
 */
export interface CellReading {
    /** The reading of the cell as the note holds it, as the one cell of a one-row table, on line 0. */
    readonly reading: NoteReading;
    /** Line 0 of the reading: "| ", the cell's text as the note holds it, and " |". */
    readonly line: string;
    /** The column of line 0 of the reading where position `offset` of the cell's text falls: in front of the written form of the character at `offset`. */
    column(offset: number): number;
    /** The position in the cell's text of the character whose written form holds column `column` of line 0; past the cell's text for a column after it. */
    offset(column: number): number;
}

/** Where a table cell's text starts on line 0 of its reading: after the "| " in front of it. */
const CellTextColumn = 2;

/**
 * Reads a table cell's text as the note holds it (see CellReading). A "|"
 * is written "\|", unless an odd number of backslashes in front of it
 * already escapes it, and a line break is written "<br>": the rules of
 * Obsidian's table editor (the function vy in app.js).
 */
export function readCell(text: string): CellReading {
    // where each character's written form starts, counted from the start
    // of the cell's text in the reading; one entry more for the end
    const starts: number[] = [];
    let written = "";
    let backslashes = 0;
    for (const c of text) {
        for (let unit = 0; unit < c.length; unit++) starts.push(written.length + unit);
        if (c === "|" && backslashes % 2 === 0) written += "\\|";
        else if (c === "\n") written += "<br>";
        else written += c;
        backslashes = c === "\\" ? backslashes + 1 : 0;
    }
    starts.push(written.length);
    const line = `| ${written} |`;
    const reading = readNote([line, "| --- |"]);
    return {
        reading,
        line,
        column: (offset) => CellTextColumn + starts[Math.max(0, Math.min(offset, text.length))],
        offset(column) {
            // the last character whose written form starts at or before
            // the column
            let at = 0;
            while (at < text.length && starts[at + 1] <= column - CellTextColumn) at++;
            return at;
        },
    };
}

/**
 * The text of one table cell with its protected text blotted out, every
 * position left where it was. A cell's text is read as the one cell of a
 * one-row table, which is exactly how it reads in the note: inline code,
 * math, comments, links, and wikilinks are what they are anywhere in a
 * line of text, while a cell that starts with "- " or "#" or "```" is no
 * list item, heading, or fence. The cell editor holds a cell's own text
 * only, so there is no note around it to read. A character is blotted
 * when the last character of its written form is (a "|" written "\|"
 * shares the fate of its "|").
 */
export function maskInlineRegions(text: string): string {
    const cell = readCell(text);
    const masked = cell.reading.maskedLine(0);
    const chars: string[] = [];
    for (let i = 0; i < text.length; i++) chars.push(masked[cell.column(i + 1) - 1] === "\0" ? "\0" : text[i]);
    return chars.join("");
}

/** The inline footnote in a table cell's text whose brackets hold column `ch`, read the same way (maskInlineRegions), or null. */
export function inlineNoteInCell(text: string, ch: number): { open: number; close: number } | null {
    const cell = readCell(text);
    const note = cell.reading.inlineNoteAt(0, cell.column(ch));
    return note === null ? null : { open: cell.offset(note.open), close: cell.offset(note.close) };
}
