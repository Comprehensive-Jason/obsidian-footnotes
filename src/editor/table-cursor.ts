import { Editor, EditorPosition } from "obsidian";

import { EditorWithCm } from "./obsidian-internals";

// While you edit a table cell, Obsidian runs a separate little editor
// inside that cell. The main editor's getCursor() does NOT follow your
// caret in there: clicking around inside a cell leaves the main editor's
// idea of the caret wherever it last was. A command that trusts getCursor()
// then writes at that stale spot, which shoves the row's pipes around and
// shreds the table.
//
// So whenever focus is inside a cell's own editor, this file works out the
// true position in the document by asking that editor instead.

/**
 * The part of a cell's own editor that the plugin uses.
 *
 * Text that has to land inside a cell you are editing is written HERE, not
 * through the main editor. The cell's widget is the thing that writes the
 * cell back into the note's markdown: escaping pipes, padding the columns,
 * mapping positions. Writing through it therefore cannot race that
 * write-back, which is exactly what a main-editor write into the same row
 * does.
 */
export interface TableCellEditor {
    state: {
        doc: { toString(): string };
        // when anchor and head differ, text is selected inside the cell;
        // the selection-to-footnote conversion (issue #35) replaces it
        selection: { main: { head: number; anchor: number } };
    };
    dispatch(spec: {
        changes?: { from: number; to?: number; insert: string };
        selection?: { anchor: number };
    }): void;
}

/**
 * Whether a smaller editor sitting INSIDE the main editor holds the focus:
 * a table cell being edited, or any similar widget editor.
 *
 * Editing the document while that is true races the little editor's
 * write-back into the note, which is the corruption family from issue #28.
 * Callers therefore wait, write somewhere else, or skip.
 *
 * One shared check; the same test used to be pasted in three places (E9).
 */
export function nestedSubEditorOwnsFocus(editor: Editor): boolean {
    const cm = (editor as EditorWithCm).cm;
    const active = cm?.contentDOM.ownerDocument.activeElement;
    return !!(
        cm &&
        active &&
        active !== cm.contentDOM &&
        cm.contentDOM.contains(active)
    );
}

/**
 * Whether `node` is part of the main editor's own text, and not of a
 * smaller editor or a widget drawn inside it: the nearest element at or
 * above it that says whether it can be edited (its "contenteditable"
 * attribute) is the main editor's text area itself.
 *
 * The twin of nestedSubEditorOwnsFocus, for a place in the page instead
 * of the focus: a table cell's editor has a text area of its own, inside
 * the main one, so "the main text area contains it" is true of a
 * selection in a cell too. On a phone, a cut from the selection toolbar
 * leaves the focus on the page's body, so the focus check cannot see a
 * cell's selection, and the main editor's old selection was cut instead
 * (hunt 2026-10-05, pin bug-toolbar-cut-in-table-cell). A node with no
 * element above it to ask is not known to be in the main text, so it is
 * not.
 */
export function mainEditorTextHolds(editor: Editor, node: Node): boolean {
    const content = (editor as EditorWithCm).cm?.contentDOM;
    if (!content) return false;
    if (node === content) return true;
    const element = typeof (node as Partial<Element>).closest === "function" ? (node as Element) : node.parentElement;
    return typeof element?.closest === "function" && element.closest("[contenteditable]") === content;
}

// The fallback for a rare case: focus is inside a nested editor, but that
// editor cannot be reached (activeTableCellEditor returned null).
//
// Editing the document while a nested editor holds focus races the
// write-back it performs when it loses focus. That write-back rebuilds its
// own region from the text as it stood BEFORE the edit, which at best
// swallows the footnote just inserted and at worst displaces a table row's
// pipes (regression reported 2026-07-14, same family as issue #28).
//
// So: hand focus back to the main editor, and edit only once the write-back
// has settled. The normal table-cell path does better and writes through
// the cell's own editor - see createAutonumFootnote and
// createFootnoteReference.
export function runOutsideTableCell(
    doc: Editor,
    run: (cursorPosition: EditorPosition) => void,
) {
    const cursorPosition = resolveTableCellCursor(doc) ?? doc.getCursor();
    const cm = (doc as EditorWithCm).cm;
    if (!cm || !nestedSubEditorOwnsFocus(doc)) {
        run(cursorPosition);
        return;
    }
    cm.focus();
    // requestAnimationFrame never fires while the window is hidden (the
    // popup teardown uses a timeout for the same reason), and that would
    // swallow the command outright. So both are armed and whichever fires
    // first runs the edit. The timers come from the editor's OWN window, so
    // a note popped out into a separate window is not scheduled on the main
    // one (E37)
    const win = cm.contentDOM.ownerDocument.defaultView ?? window;
    let ran = false;
    const invoke = () => {
        if (ran) return;
        ran = true;
        run(cursorPosition);
    };
    win.requestAnimationFrame(invoke);
    win.setTimeout(invoke, 100);
}

/**
 * The caret inside a table cell's editor, clamped to the cell's text.
 *
 * Why the clamp: Obsidian rebuilds a cell's editor after an undo or a row
 * re-sync, and for a moment the selection it reports can belong to the
 * LONGER text the cell had before. A caret past the end of the text made
 * every slice built from it land nowhere, so the born-dead check refused
 * an inline footnote with the protected-text toast, now and then, in the
 * last cell of a table (Jason's report, sheet 06, 2026-09-11; never caught
 * in the act, so this closes the one door the symptoms point at). Every
 * cell path reads its caret through here.
 */
export function cellCaret(cell: TableCellEditor): number {
    const length = cell.state.doc.toString().length;
    return Math.max(0, Math.min(cell.state.selection.main.head, length));
}

/** Both ends of a cell editor's selection, clamped the same way; `from` never exceeds `to`. */
export function cellSelection(cell: TableCellEditor): { from: number; to: number } {
    const length = cell.state.doc.toString().length;
    const clamp = (n: number) => Math.max(0, Math.min(n, length));
    const anchor = clamp(cell.state.selection.main.anchor);
    const head = clamp(cell.state.selection.main.head);
    return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
}

/**
 * The editor object of the table cell being edited, or null when focus is
 * not inside a cell's own editor.
 *
 * Obsidian gives plugins no handle on that editor through the cell's DOM.
 * Older builds put a `cmView` on the content element; current ones do not
 * (verified 2026-07-15). So the cell's editor is recovered through
 * CodeMirror's own registry instead: `EditorView.findFromDOM` gives back
 * the innermost EditorView that owns an element. The main view's
 * constructor IS the app's EditorView class, so that function can be
 * reached without importing @codemirror.
 */
export function activeTableCellEditor(editor: Editor): TableCellEditor | null {
    const cm = (editor as EditorWithCm).cm;
    if (!cm) return null;
    const active = cm.contentDOM.ownerDocument.activeElement;
    if (!active || active === cm.contentDOM || !cm.contentDOM.contains(active)) {
        return null;
    }
    if (!active.closest("td, th")) return null;
    const EditorViewClass = cm.constructor as unknown as {
        findFromDOM?: (el: HTMLElement) => TableCellEditor | null;
    };
    const view = EditorViewClass.findFromDOM?.(active as HTMLElement) ?? null;
    if (!view || (view as unknown) === (cm as unknown)) return null;
    return view;
}

/** Where each cell begins and ends within one table row line. An escaped
 * pipe ("\|") is ordinary text, not a cell border. */
export function tableRowCellSpans(lineText: string): { from: number; to: number }[] {
    const spans: { from: number; to: number }[] = [];
    // a row need not start with a pipe: "A | B" is a valid row in
    // GitHub-flavored Markdown. Without one, the first cell starts right
    // after the quote markers, if any, instead of just after a "|". The
    // markers of a quoted row ("> | a | b |") are not a cell: a caret on
    // them is outside every cell, and a reference written there un-quotes
    // the row or adds a cell the delimiter row does not have (Kimi hunt
    // cycle 3, 2026-09-16).
    const lead = lineText.match(/^\s*(?:>\s?)*\s*(\|)?/);
    let start = lead?.[0].length ?? 0;
    let sawPipe = lead?.[1] !== undefined;
    for (let i = start; i < lineText.length; i++) {
        const c = lineText[i];
        if (c === "\\") {
            i++;
        } else if (c === "|") {
            sawPipe = true;
            spans.push({ from: start, to: i });
            start = i + 1;
        }
    }
    // a line with no unescaped pipe anywhere is not a table row, so it has
    // no cells
    if (!sawPipe) return [];
    if (start < lineText.length) {
        spans.push({ from: start, to: lineText.length });
    }
    return spans;
}

/**
 * Where the caret inside the table cell being edited sits in the note's own
 * text. Null when focus is not in a cell's editor, and also null when any
 * step of the lookup fails - in that case the caller should go on trusting
 * the main editor's cursor.
 */
export function resolveTableCellCursor(editor: Editor): EditorPosition | null {
    const cm = (editor as EditorWithCm).cm;
    if (!cm || !cm.posAtDOM) return null;

    // this only matters while an editor nested inside the main one has focus
    const doc = cm.contentDOM.ownerDocument;
    const active = doc.activeElement;
    if (!active || active === cm.contentDOM || !cm.contentDOM.contains(active)) {
        return null;
    }

    const td = active.closest("td, th");
    const table = active.closest("table");
    const tr = active.closest("tr");
    if (!td || !table || !tr) return null;

    const cellView = activeTableCellEditor(editor);
    if (!cellView) return null;

    // the table's own start position gives the first row's line number.
    // The rendered table has no row for the "| --- |" delimiter line, so
    // every row after the first sits one line further down than its index
    const startLine = editor.offsetToPos(cm.posAtDOM(table)).line;
    const rowIdx = Array.prototype.indexOf.call(table.rows, tr);
    if (rowIdx < 0) return null;
    const line = startLine + (rowIdx === 0 ? 0 : rowIdx + 1);
    if (line > editor.lastLine()) return null;

    const lineText = editor.getLine(line);
    // a rendered column can run past the end of the source row's cells, so
    // check the index against the list instead of trusting it
    const spans = tableRowCellSpans(lineText);
    const cellIndex = (td as HTMLTableCellElement).cellIndex;
    if (cellIndex < 0 || cellIndex >= spans.length) return null;
    const span = spans[cellIndex];

    // The cell editor's text is the cell's source without the padding
    // spaces. Find where that text begins inside the raw line's cell, then
    // walk the cell editor's caret offset forward through the raw text
    // (rawCellColumn). The cell's text begins at its first non-space
    // column. Searching for the cell editor's text inside the raw cell
    // instead skipped the backslash of a leading escaped pipe, and a caret
    // read raw rather than through cellCaret walked a stale offset onto the
    // closing pipe (Claude sweep 2026-09-13).
    const rawCell = lineText.slice(span.from, span.to);
    const start = rawCell.length - rawCell.trimStart().length;
    const ch = Math.min(span.from + rawCellColumn(rawCell, start, cellCaret(cellView)), span.to);
    return { line, ch };
}

/**
 * The column of the raw cell `raw` that column `shown` of the cell
 * editor's text stands for, when the cell's text starts at column `from`
 * of `raw`.
 *
 * Obsidian's cell editor shows a cell's source with two changes and no
 * others (its source-to-cell conversion in app.js, read 2026-10-06): an
 * escaped pipe "\|" shows as a plain "|", which hides the last backslash
 * of an odd run of them in front of a pipe, and a "<br>" outside inline
 * code shows as a line break. So each hidden backslash uses up a column of
 * the raw line but none of the cell editor, and each "<br>" four columns
 * for one. Plain addition landed one column short per escaped pipe, which
 * read a caret just inside a reference as OUTSIDE it and nested a new
 * reference there (bug-table-escape-offset). Every other character shows
 * as itself, a backslash included: "\\" is two characters in the cell
 * too. The walk used to take any backslash followed by the character the
 * cell shows next for an escape, so it read "\\" as one character, and
 * every caret after it one column too far on (hunt 2026-10-02, pin
 * bug-press-table-cell-escaped-backslash).
 */
function rawCellColumn(raw: string, from: number, shown: number): number {
    // the inline code spans, found as the cell editor finds them, since a
    // "<br>" inside one stays as it is
    const code = [...raw.slice(from).matchAll(/(`+)[^`]+\1/g)].map((match) => ({
        start: from + match.index,
        end: from + match.index + match[0].length,
    }));
    // whether the backslash at `at` ends an odd run of backslashes
    const oddRunEndsAt = (at: number): boolean => {
        let run = 0;
        while (at - run >= from && raw[at - run] === "\\") run++;
        return run % 2 === 1;
    };
    let at = from;
    for (let c = 0; c < shown && at < raw.length; c++) {
        if (raw[at] === "\\" && raw[at + 1] === "|" && oddRunEndsAt(at)) {
            at += 2; // the hidden backslash, plus the pipe the cell shows
        } else if (raw.slice(at, at + 4).toLowerCase() === "<br>" && !code.some((span) => span.start < at && span.end > at + 4)) {
            at += 4; // one line break in the cell
        } else {
            at += 1;
        }
    }
    return at;
}

// One cell of the "| --- |" row that separates a table's header from its
// body: at least one dash, with optional alignment colons around it. It is
// judged after any blockquote markers are stripped off the front, so a
// quoted table ("> | --- |") qualifies too.
const DelimiterCell = /^\s*:?-+:?\s*$/;
const QuotePrefix = /^(\s*>)+\s?/;

/**
 * Whether the line is the "| --- |" row that separates a table's header
 * from its body: every cell a run of dashes with optional alignment colons.
 * Those dashes are not cell text; they are what makes the lines a table,
 * so nothing may be written into them.
 */
export function isTableDelimiterRow(lineText: string): boolean {
    const stripped = lineText.replace(QuotePrefix, "");
    const spans = tableRowCellSpans(stripped);
    return (
        spans.length > 0 &&
        spans.every((span) => DelimiterCell.test(stripped.slice(span.from, span.to)))
    );
}


/**
 * The caret a command should act on. When `cell` is set, that is the caret
 * inside the cell being edited, translated into a position in the note (the
 * main editor's own caret is stale then - see resolveTableCellCursor).
 * Otherwise it is simply the main editor's caret. One place spells that
 * fallback out; it used to be written inline at five call sites.
 */
export function resolvedCaret(doc: Editor, cell: TableCellEditor | null): EditorPosition {
    return (cell ? resolveTableCellCursor(doc) : null) ?? doc.getCursor();
}
