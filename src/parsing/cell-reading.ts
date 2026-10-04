// A table cell's text, read the way it reads in the note. The cell editor
// holds a cell's own text only, so there is no note around it to read:
// the text is read as the one cell of a one-row table, which is exactly
// how it reads in the note (it moved here from markdown-scan.ts in step 4
// of the runtime swap, 2026-10-03, when the rest of that file went).

import { NoteReading, readNote } from "./note-reading";

/**
 * The text of one table cell with its protected text blotted out, every
 * position left where it was. A cell's text is read as the one cell of a
 * one-row table, which is exactly how it reads in the note: inline code,
 * math, comments, links, and wikilinks are what they are anywhere in a
 * line of text, while a cell that starts with "- " or "#" or "```" is no
 * list item, heading, or fence. The cell editor holds a cell's own text
 * only, so there is no note around it to read (table cells and the
 * footnote section heading are the callers).
 */
export function maskInlineRegions(line: string): string {
    return cellReading(line).maskedLine(0).slice(2, 2 + line.length);
}

/** The inline footnote in a table cell's text whose brackets hold column `ch`, read the same way (maskInlineRegions), or null. */
export function inlineNoteInCell(text: string, ch: number): { open: number; close: number } | null {
    const note = cellReading(text).inlineNoteAt(0, ch + 2);
    return note === null ? null : { open: note.open - 2, close: note.close - 2 };
}

/** Where a table cell's text starts on line 0 of its cellReading: after the "| " in front of it. */
export const CellTextColumn = 2;

/** The reading of a cell's text as the one cell of a one-row table: a table needs its delimiter row, and "| " goes in front, so the text starts at column 2 of line 0 (CellTextColumn). */
export function cellReading(text: string): NoteReading {
    return readNote([`| ${text} |`, "| --- |"]);
}
