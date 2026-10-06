import { Editor, EditorPosition } from "obsidian";

import type FootnotePlugin from "../main";
import { ValidatedTextModal } from "./validated-text-modal";
import {
    escapedAt,
    footnoteNameProblem,
    idListIncludes,
    referenceText,
} from "../parsing/footnote-grammar";
import {
    comparePositions,
    endOfWordForSelection,
    moveCursorAndSetJumpPoint,
    startOfWordOffset,
} from "../editor/cursor-motion";
import { commandHotkeys } from "../editor/obsidian-internals";
import { planDefinitionAppend } from "./definition-append";
import { contextOfLines, DocContext, docContext, docLines, listExistingFootnoteDefinitions } from "../editor/doc-context";
import { bareInsertionVerdict, sanitizeInlineFootnoteContent } from "./inline-footnotes";
import {
    caretInsideMaskedSpan,
    simulateChanges,
    pressLineVerdict,
    verifyLiveFootnoteInsertion,
} from "../editor/insertion-liveness";
import { maskInlineRegions, readCell } from "../parsing/cell-reading";
import { cellImageStarts, imageStartsOn } from "../parsing/landing";
import { linesReadAlike, NoteReading, readNote } from "../parsing/note-reading";
import {
    autonumFootnoteId,
    landCellDefinitionAppend,
    landDefinitionBackedInsertion,
    refusedCreation,
    replaceInTableCell,
} from "./create-footnote";
import {
    nameAlreadyUsed,
    NestedFootnoteNotice,
    NoFootnoteCreated,
    showNotice,
} from "../editor/notice";
import {
    cellSelection,
    isTableDelimiterRow,
    TableCellEditor,
    tableRowCellSpans,
} from "../editor/table-cursor";

// Conversion: turning selected text into a footnote (issue #35).
//
// Normally a footnote command inserts at the caret. When you have text
// selected, it replaces that text instead. Each key does it its own way:
//
//   numbered - the selected text moves into a new definition's body
//   inline   - the selected text is wrapped as "^[…]" where it sits
//   named    - a small modal asks for the name, then the numbered
//              behavior runs under the name you typed
//   paste    - refuses and points you at the other three keys
//
// The named key needs the modal because the usual named flow takes two
// presses, and two presses cannot carry a body without keeping state
// between them (Jason's ask 2026-08-13). The paste key refuses because
// its body is the clipboard, so a press with a selection is genuinely
// ambiguous: two candidate bodies, no way to pick.
//
// There is no setting for any of this; it is always on (Jason's call,
// 2026-08-12). Before it existed, a press with a selection inserted at
// the old caret position, which served nobody.
//
// Multi-line selections convert too (Jason's ask 2026-08-19, because
// academic footnotes hold whole paragraphs). The numbered and named keys
// turn the selected block into a multi-paragraph definition, its
// continuation lines indented four spaces. That is the shape the note
// reading and the jump commands already understand. The inline key refuses a
// selection that spans lines and points at those two keys instead
// (Jason's ruling 2026-08-20: flattening it the way paste does almost
// never looked right except on clean paragraphs, and paste already
// covers that use case).
//
// Protected text (fences, math, comments, inline code spans) can travel
// into the footnote, but only when the selection contains the whole
// construct. A selection that CUTS one refuses: an edge sitting inside a
// construct, or one delimiter grabbed without its partner. Cutting like
// that would change how Obsidian reads innocent text further down the
// note.

export const SelectionSpanNotice =
    "Select one continuous stretch of text to turn it into a footnote.";
export const SelectionCommandNotice =
    "To turn the selected text into a footnote, use the numbered, named, or inline footnote command.";
export const SelectionChangedNotice =
    "The note changed while naming the footnote. Reselect the text and try again.";
// An inline footnote lives on one line, so it cannot hold a selection
// that spans several. Flattening such a selection into one line, the way
// the paste key does, was tried and then reversed (Jason, 2026-08-20):
// outside clean paragraphs the result almost never looked right.
export const InlineSelectionNotice =
    "Inline footnotes are single-line. Use the numbered or named footnote command to convert a multi-line selection.";
// A nested footnote is a footnote inside another footnote's body. The
// plugin prevents them everywhere (Jason's ruling 2026-08-24, after the
// Obsidian Academia Discord confirmed nobody uses them and modern style
// guides have engineered the pattern out). So converting a selection that
// touches a live reference or a live inline footnote refuses: swallowing
// one whole would nest it in the new footnote's body, and overlapping one
// only partly would cut it in half. Reference-shaped text inside a code
// span is not a live footnote, so it travels along like ordinary text.
// (The refusal message is NestedFootnoteNotice, shared with the caret
// guards, so the one rule always speaks with one sentence.)
//
// This message is deliberately not ProtectedCreationNotice (Jason's
// manual pass, 2026-08-13). That one means the caret sits inside
// protected text. This one means a selection EDGE cuts through protected
// text. Protected text held whole inside the selection is fine
// (2026-08-19); it is cutting one apart that would corrupt what is left
// behind.
export const ProtectedSelectionNotice =
    NoFootnoteCreated + "the selection cuts through code, math, or other protected text. Select all of it or none of it.";

// A selection that takes only PART of a table refuses (Jason's ruling
// 2026-09-04, from his manual pass). Moving a cell, a few cells, or a whole
// row into a footnote shreds the table that stays behind, and the pipes
// and dashes that travel render as nothing sensible in the definition.
// Two cases still work: text inside a single cell converts, because the
// cell keeps its shape, and a whole table selected together with the
// prose around it travels like any other block.
export const TableSelectionNotice =
    NoFootnoteCreated + "the selection cuts through a table. Select text inside one cell, or the whole table with the text around it.";

export type FootnoteCommandKind = "autonum" | "named" | "inline" | "paste";

// The Name-the-footnote modal that is currently open, or null. It is kept
// here so that pressing a footnote command while the modal is open
// submits it, exactly as Enter would, instead of opening a second modal
// on top of the first (Jason's ask 2026-08-22; always on, no toggle). It
// mirrors the popup editor, where pressing the key again closes it. A
// single slot is enough, because a modal covers the whole app and only
// one can be open at a time.
let activeNameModal: { submit: () => void } | null = null;

/** NameSelectionModal calls this when it opens, and again with null when it closes. Exported so tests can call it; in the running plugin only the modal below does. */
export function registerActiveNameModal(
    modal: { submit: () => void } | null,
): void {
    activeNameModal = modal;
}

/**
 * Submits the open Name-the-footnote modal, if one is open.
 *
 * Returns true when a modal was open, which means this press was used up
 * by the modal. What the modal then does is exactly what Enter does: it
 * converts under the name you typed, closes on an empty name, or stays
 * open and shows why the name can't be used. Returns false when no modal
 * is open, and the command carries on as usual.
 */
export function submitActiveNameModal(): boolean {
    if (activeNameModal === null) return false;
    activeNameModal.submit();
    return true;
}

/**
 * The selection claim: the first thing every creation command checks.
 *
 * A claim is an early handler that takes the whole press before the
 * normal cascade of steps begins. If there is text selected that can be
 * converted, this converts it (numbered and inline) or explains why this
 * particular key cannot (named, paste, a selection spanning lines,
 * several separate selections). Either way it returns true, meaning the
 * press has been dealt with.
 *
 * It returns false when there is nothing usable selected, and then the
 * ordinary caret cascade takes the press. A selection holding only
 * whitespace counts as nothing: there is no text to move into a footnote.
 *
 * `cursorPosition` is the caret position in the document that the
 * numbered and named commands have already worked out (they need it
 * because a table cell has its own little editor). Without it, the jump
 * to the new definition after a cell conversion falls back to
 * getCursor().
 */
export function selectionPressHandled(
    plugin: FootnotePlugin,
    doc: Editor,
    cell: TableCellEditor | null,
    command: FootnoteCommandKind,
    cursorPosition?: EditorPosition,
): boolean {
    if (cell) {
        // While you are editing a table cell, the cell has its own little
        // editor, and that is where the real selection lives. The main
        // editor's selection is out of date (see table-cursor.ts).
        const { from: cellFrom, to: cellTo } = cellSelection(cell);
        const anchor = cellFrom;
        const head = cellTo;
        if (anchor === head) return false;
        // The paste key never converts a selection, because its body is
        // the clipboard, so any selection at all is sent to the other
        // keys. This check comes before the whitespace trimming, matching
        // the main-editor branch further down (review A5, Jason confirmed
        // live 2026-09-08: a cell selection of nothing but whitespace used
        // to slip past here and paste, while the main editor redirected).
        if (command === "paste") {
            showNotice(SelectionCommandNotice, 8000);
            return true;
        }
        const cellText = cell.state.doc.toString();
        let from = Math.min(anchor, head);
        let to = Math.max(anchor, head);
        while (from < to && /\s/.test(cellText[from])) from++;
        while (to > from && /\s/.test(cellText[to - 1])) to--;
        if (from === to) return false;
        // Grow the selection out to whole words, the same way the
        // main-editor branch below does.
        if (plugin.settings.expandSelectionToWholeWords) {
            from = startOfWordOffset(cellText, from);
            to = endOfWordForSelection(cellText, to, plugin.settings.footnotePlacement, cellImageStarts(cellText, docContext(doc).reading().linkLabels));
        }
        // Refuse an edge that cuts into protected text here and now,
        // rather than leaving it to the simulation. The liveness checks
        // only prove that the RESULT is a live footnote. A selection that
        // swallows one delimiter of a code span can produce a perfectly
        // live result precisely by destroying that span. A span the
        // selection contains whole is fine and travels into the footnote
        // (2026-08-19; the main editor has the twin of this check).
        const maskedCell = maskInlineRegions(cellText);
        if (
            caretInsideMaskedSpan(maskedCell, from, false, false) ||
            caretInsideMaskedSpan(maskedCell, to, false, false)
        ) {
            showNotice(ProtectedSelectionNotice, 8000);
            return true;
        }
        // Nested footnotes are refused inside table cells too, under the
        // same plugin-wide ruling (2026-08-24). The cell's text is read as
        // the one cell of a one-row table, where a label-shaped "[^x]:" is
        // a reference, as it is in the note.
        const cellRead = readCell(cellText);
        if (spanTouchesFootnote(cellRead.reading, 0, cellRead.column(from), cellRead.column(to))) {
            showNotice(NestedFootnoteNotice, 8000);
            return true;
        }
        const text = cellText.slice(from, to);
        // The new reference sits snug against the text in front of the
        // selection, with no space between (see absorbLeadingSpace). A
        // cell's own text holds no block syntax and never contains a pipe,
        // so the only things that can come before the selection are prose
        // or the start of the cell.
        const replaceFrom = absorbLeadingSpace(cellText, from, 0);
        const lead = cellText.slice(replaceFrom, from);
        if (command === "inline") {
            const wrapped = `^[${sanitizeInlineFootnoteContent(text)}]`;
            // If the result would not be a live footnote, the refusal and
            // its notice happen inside replaceInTableCell.
            replaceInTableCell(cell, wrapped, replaceFrom, to, wrapped.length, docContext(doc).reading().linkLabels);
            return true;
        }
        if (command === "named") {
            new NameSelectionModal(plugin, doc, {
                kind: "cell",
                cell,
                selection: { from: replaceFrom, to, text, lead },
                cursorPosition,
            }).open();
            return true;
        }
        convertCellSelection(
            plugin,
            doc,
            cell,
            { from: replaceFrom, to, text, lead },
            cursorPosition,
            autonumFootnoteId(plugin, doc),
        );
        return true;
    }

    const resolved = normalizedMainSelection(doc);
    if (resolved === null) return false;
    // The paste key never converts a selection, no matter how many
    // stretches are selected, because its body is the clipboard. So it
    // points at the other keys BEFORE the one-stretch check runs. Order
    // matters here: with the checks the other way round, two Alt-dragged
    // ranges got the "one continuous stretch" message, which tells you to
    // fix something that would still not let the paste key convert
    // (Jason's report, 2026-09-08).
    if (command === "paste") {
        showNotice(SelectionCommandNotice, 8000);
        return true;
    }
    if (resolved === "multi") {
        showNotice(SelectionSpanNotice, 8000);
        return true;
    }
    // Shrink the selection in to the text itself, dropping whitespace at
    // both edges, line breaks included. A selection made by double-click
    // or by dragging routinely picks up a space at the edge or a trailing
    // newline, and that whitespace belongs to the prose, not to the
    // footnote.
    const trimmed = trimSelectionEdges(doc, resolved.from, resolved.to);
    if (trimmed === null) return false;
    // Then, with the setting on (which is the default), grow what is left
    // out to whole words. This is the selection version of the
    // end-of-word adjustment the insert keys already do (Jason's ask
    // 2026-08-29). If the selection starts in the middle of a word, the
    // start walks back to that word's first character. The end moves to
    // the end of its word plus one punctuation mark, matching the insert
    // keys exactly; Jason's call was that even a selection already ending
    // at a word end picks up the punctuation mark.
    //
    // This growing happens BEFORE every refusal check below, so those
    // checks judge the range that would really be converted, not the one
    // you happened to drag.
    const ctx = docContext(doc);
    if (plugin.settings.expandSelectionToWholeWords) {
        trimmed.from = {
            line: trimmed.from.line,
            ch: startOfWordOffset(doc.getLine(trimmed.from.line), trimmed.from.ch),
        };
        trimmed.to = {
            line: trimmed.to.line,
            // the reading says which "!" opens an image or an embed, which
            // the selection does not take in as its punctuation mark (hunt
            // 2026-10-06, cycle 4, cluster P1)
            ch: endOfWordForSelection(
                doc.getLine(trimmed.to.line),
                trimmed.to.ch,
                plugin.settings.footnotePlacement,
                imageStartsOn(ctx.reading(), trimmed.to.line),
            ),
        };
    }
    // The inline key works within a single line only. A selection that
    // spans lines is sent to the numbered and named keys, which put the
    // text in a definition instead (2026-08-20).
    if (command === "inline" && trimmed.from.line !== trimmed.to.line) {
        showNotice(InlineSelectionNotice, 8000);
        return true;
    }
    const text = rangeText(ctx.lines, trimmed.from, trimmed.to);
    const table = tableVerdict(ctx, trimmed.from, trimmed.to);
    if (table === "cuts") {
        showNotice(TableSelectionNotice, 8000);
        return true;
    }
    // The nesting refusals come first: they name the real reason, where
    // the reclassification check below would only see that the lines
    // after a swallowed definition stop being its body.
    //
    // A selection that sits inside another footnote's definition, or laps
    // over one, would nest footnotes inside each other. It is refused just
    // as the caret presses are (Jason's ruling 2026-08-13). Any overlap at
    // all counts: starting inside a definition would nest the new footnote
    // into the old one; swallowing one would nest the old one into the new
    // footnote. Every definition counts, wherever it sits: one in a
    // blockquote or callout with its quoted continuation (second review
    // 2026-09-09, Kimi hunt cycle 3, 2026-09-16), and one in a list item
    // (Jason's ruling 1, option a, 2026-10-03).
    if (
        ctx.reading().definitions.some(
            (definition) => trimmed.from.line <= definition.end && trimmed.to.line >= definition.start,
        )
    ) {
        showNotice(NestedFootnoteNotice, 8000);
        return true;
    }
    // And a selection that touches any live footnote at all refuses:
    // a reference, a placeholder, or an inline footnote (nesting is
    // prevented plugin-wide, 2026-08-24).
    if (selectionTouchesFootnote(ctx, trimmed.from, trimmed.to)) {
        showNotice(NestedFootnoteNotice, 8000);
        return true;
    }
    // Refuse a selection that cuts protected text here and now, rather
    // than leaving it to the simulation. The born-dead checks only prove
    // that the RESULT is a live footnote; a selection that swallows one
    // delimiter can produce a live result precisely by destroying the
    // construct. A real example: wrapping the first backtick of a fence
    // opener un-fenced everything below it (found by the conversion
    // property test, 2026-08-12). Protected text the selection contains
    // whole is fine and travels into the footnote (2026-08-19). What
    // refuses is an edge strictly inside protected text, or a replacement
    // that would change how Obsidian reads a line the edit never touches.
    const replacement =
        command === "inline"
            ? `^[${sanitizeInlineFootnoteContent(text)}]`
            : "[^x]";
    if (
        selectionCutsProtectedText(ctx, trimmed.from, trimmed.to) ||
        replacementReclassifiesDoc(ctx, trimmed.from, trimmed.to, replacement)
    ) {
        showNotice(ProtectedSelectionNotice, 8000);
        return true;
    }
    // The new reference sits snug against the text in front of the
    // selection, so the run of whitespace before it is replaced along with
    // the selection itself (absorbLeadingSpace decides how much).
    const firstLine = doc.getLine(trimmed.from.line);
    const lastLine = doc.getLine(trimmed.to.line);
    // A whole table goes from its first row's first character to its last
    // row's end: the indent and the trailing spaces belonged to the table,
    // so they leave with it instead of staying next to the reference
    // (Claude sweep 2026-09-13).
    const replaceFrom =
        table === "whole"
            ? { line: trimmed.from.line, ch: 0 }
            : {
                  line: trimmed.from.line,
                  ch: absorbLeadingSpace(firstLine, trimmed.from.ch, ctx.reading().blockSyntaxEnd(trimmed.from.line)),
              };
    const replaceTo = table === "whole" ? { line: trimmed.to.line, ch: lastLine.length } : trimmed.to;
    const selection: ConvertedSelection = {
        from: replaceFrom,
        to: replaceTo,
        text,
        lead: firstLine.slice(replaceFrom.ch, trimmed.from.ch),
        trail: lastLine.slice(trimmed.to.ch, replaceTo.ch),
    };
    if (command === "inline") {
        convertMainSelectionToInline(plugin, doc, selection, ctx);
    } else if (command === "named") {
        new NameSelectionModal(plugin, doc, { kind: "main", selection }).open();
    } else {
        convertMainSelection(plugin, doc, selection, ctx, autonumFootnoteId(plugin, doc, ctx));
    }
    return true;
}

/**
 * A selection that is about to become a footnote. `from` up to (but not
 * including) `to` is the range the new reference replaces. `text` is what
 * moves into the footnote. `lead` is the whitespace swallowed in front of
 * the text: it is part of the replaced range, never part of the body.
 */
export interface ConvertedSelection {
    from: EditorPosition;
    to: EditorPosition;
    text: string;
    /** The whitespace swallowed in front of the selection by absorbLeadingSpace, or "" when there was none. The replacement still starts at `from`, and the checks for "did the note change under the modal" compare `lead + text + trail`. */
    lead: string;
    /** The whitespace swallowed after the selection, which only a whole table's trailing spaces produce; "" otherwise. */
    trail?: string;
}

/** The same thing as ConvertedSelection, but for a table cell's own editor: the positions are offsets into the cell's text. */
export interface CellSelection {
    from: number;
    to: number;
    text: string;
    lead: string;
}

/**
 * Works out where the replacement should start, so the new reference ends
 * up snug against the text in front of it.
 *
 * A footnote reference never has a space before it (Jason's formatting
 * ruling 2026-09-08, spotted in the hero GIF: converting "range. The buoy
 * log confirms this." left behind "range. [^2]").
 *
 * So the run of spaces or tabs immediately before `ch` is swallowed, but
 * only when real prose comes before it on the same line. It is left alone
 * when what comes before is the line's block syntax, a table pipe, or
 * nothing at all. `syntaxEnd` is the column where the line's block syntax
 * ends (NoteReading.blockSyntaxEnd: quote and list markers, a task box of
 * any kind, a callout's marker, a heading's "#" marks), and a run that
 * starts before it belongs to that syntax. Stripping the space in those
 * cases would either break the structure (you would get "-[^1]", or
 * "> [!note]-[^1]", which is no callout) or achieve nothing. The reading
 * says where the syntax ends, so every kind of marker is covered without a
 * pattern of its own here (hunt 2026-10-05, pin
 * bug-selection-eats-marker-space: the pattern this replaced knew no
 * callout marker and no task box but "[ ]", "[x]", and "[X]").
 */
export function absorbLeadingSpace(line: string, ch: number, syntaxEnd: number): number {
    const before = line.slice(0, ch);
    const run = before.match(/[ \t]+$/);
    if (!run) return ch;
    const prose = before.slice(0, before.length - run[0].length);
    if (prose === "" || prose.length < syntaxEnd) return ch;
    if (prose.endsWith("|")) return ch;
    return ch - run[0].length;
}

/**
 * Trims whitespace off both ends of the selection and returns what is
 * left, or null when the selection held nothing but whitespace.
 *
 * The trimming walks across line breaks, because a selection spanning
 * several lines routinely begins or ends on a blank one. It also tidies
 * the full-line drag, which ends at character 0 of the NEXT line, back
 * onto the line you actually dragged.
 */
function trimSelectionEdges(
    doc: Editor,
    from: EditorPosition,
    to: EditorPosition,
): { from: EditorPosition; to: EditorPosition } | null {
    let { line: fromLine, ch: fromCh } = from;
    let { line: toLine, ch: toCh } = to;
    while (fromLine < toLine || fromCh < toCh) {
        const lineText = doc.getLine(fromLine);
        if (fromCh >= lineText.length) {
            // The line break at the end of a line counts as whitespace
            // too, so step over it to the next line.
            fromLine++;
            fromCh = 0;
            continue;
        }
        if (!/\s/.test(lineText[fromCh])) break;
        fromCh++;
    }
    while (toLine > fromLine || toCh > fromCh) {
        if (toCh === 0) {
            toLine--;
            toCh = doc.getLine(toLine).length;
            continue;
        }
        if (!/\s/.test(doc.getLine(toLine)[toCh - 1])) break;
        toCh--;
    }
    if (fromLine === toLine && fromCh === toCh) return null;
    return {
        from: { line: fromLine, ch: fromCh },
        to: { line: toLine, ch: toCh },
    };
}

/**
 * Whether the range from `from` up to `to` on line `line` touches any
 * footnote: a live reference, an empty "[^]" placeholder, or an inline
 * footnote, as the note reading finds them.
 *
 * Any overlap counts. Containing one whole would nest it in the new
 * footnote's body; overlapping one only partly would cut it in half. A
 * lazy label's "[^x]" is a live reference, and a selection over it nests
 * that reference into the new footnote (Kimi and Claude sweeps
 * 2026-09-13).
 *
 * An inline footnote that runs over a line break of its paragraph counts
 * as one on a single line does: a range that starts or ends inside its
 * brackets touches it, on any of its lines (hunt 2026-10-05, round 2, pin
 * bug-selection-multi-line-inline-footnote: the one-line lookup let such a
 * selection tear it in half or nest a new footnote inside it). It is the
 * lookup the press's hop uses (inlineNoteHolding, 2e58d86).
 *
 * Fakes do not count. A fake is reference-shaped text that is not really a
 * footnote, usually because it sits in code, math, or a comment.
 */
function spanTouchesFootnote(reading: NoteReading, line: number, from: number, to: number): boolean {
    if (reading.referencesOn(line).some((occurrence) => occurrence.start < to && occurrence.end > from)) return true;
    // the placeholder is no reference to the reading, so it is found on
    // the masked twin, where protected text holds none
    const masked = reading.maskedLine(line);
    for (let i = 0; (i = masked.indexOf("[^]", i)) !== -1; i += "[^]".length) {
        // an escaped "\[^]" is prose about footnotes, not a placeholder
        // (Kimi hunt cycle 5, 2026-09-16; the alert already knew)
        if (escapedAt(masked, i)) continue;
        if (i < to && i + "[^]".length > from) return true;
    }
    // one the range holds whole sits on this line; one the range starts or
    // ends inside holds that edge, wherever it opens and closes
    if (reading.inlineNotesOn(line).some((note) => note.open < to && note.close + 1 > from)) return true;
    return reading.inlineNoteHolding(line, from) !== null || reading.inlineNoteHolding(line, to) !== null;
}

/**
 * How the selection stands to any table: "none" when neither edge is on a
 * table row, "whole" when it holds one table edge to edge, "cuts" when it
 * takes only PART of a table.
 *
 * An edge landing on a table row cuts, unless both edges sit inside the
 * same cell of the same row, because text within one cell converts fine.
 * A table held whole passes: with both edges out in the prose around it
 * ("none"), or with the edges exactly on its first and last rows ("whole";
 * Jason's ruling, sheet 05, 2026-09-09; it used to be refused on the
 * belief that a table cannot begin on the label line, and Obsidian renders
 * one that does).
 */
function tableVerdict(
    ctx: DocContext,
    from: EditorPosition,
    to: EditorPosition,
): "none" | "whole" | "cuts" {
    const rows = ctx.reading().tableRowLines;
    if (!rows[from.line] && !rows[to.line]) return "none";
    if (from.line !== to.line) {
        // A table held whole, edge to edge on its first and last rows,
        // converts (Jason's ruling, sheet 05, 2026-09-09). The edges are
        // judged against the rows' text, not their raw length: the
        // selection arrives trimmed, so a last row ending in trailing
        // spaces, or a table indented a space or two, used to be refused
        // with advice that could not be followed (Claude sweep
        // 2026-09-13).
        const first = ctx.lines[from.line];
        const last = ctx.lines[to.line];
        const wholeTable =
            rows[from.line] &&
            rows[to.line] &&
            from.ch <= first.length - first.trimStart().length &&
            to.ch >= last.trimEnd().length &&
            !rows[from.line - 1] &&
            !rows[to.line + 1] &&
            rows.slice(from.line, to.line + 1).every(Boolean);
        return wholeTable ? "whole" : "cuts";
    }
    // The row of dashes under the header is not cell text, whichever cell
    // it sits in: converting it ends the table (Kimi sweep 2026-09-13).
    if (isTableDelimiterRow(ctx.lines[from.line] ?? "")) return "cuts";
    return tableRowCellSpans(ctx.lines[from.line] ?? "").some(
        (span) => span.from <= from.ch && to.ch <= span.to,
    )
        ? "none"
        : "cuts";
}

/** Runs spanTouchesFootnote over every line of a trimmed selection, so a selection spanning lines is checked the same way a single-line one is. */
function selectionTouchesFootnote(
    ctx: DocContext,
    from: EditorPosition,
    to: EditorPosition,
): boolean {
    for (let line = from.line; line <= to.line; line++) {
        const lineText = ctx.lines[line] ?? "";
        const start = line === from.line ? from.ch : 0;
        const end = line === to.line ? to.ch : lineText.length;
        if (spanTouchesFootnote(ctx.reading(), line, start, end)) {
            return true;
        }
    }
    return false;
}

/** The text between `from` and `to`, lines joined with "\n". This is a stand-in for the editor's own getRange that also works against the fake editor the tests use. */
function rangeText(
    lines: string[],
    from: EditorPosition,
    to: EditorPosition,
): string {
    if (from.line === to.line) {
        return (lines[from.line] ?? "").slice(from.ch, to.ch);
    }
    const parts = [(lines[from.line] ?? "").slice(from.ch)];
    for (let i = from.line + 1; i < to.line; i++) parts.push(lines[i] ?? "");
    parts.push((lines[to.line] ?? "").slice(0, to.ch));
    return parts.join("\n");
}

/**
 * Whether either edge of the selection cuts into protected text.
 *
 * Three ways it can: the edge is strictly inside a protected span on its
 * own line, or inside a region that runs over several lines (a comment,
 * math, or a code fence) and crosses that edge, or anywhere inside the
 * YAML frontmatter at the top of the note. Frontmatter is never prose, and
 * a footnote body holding half a properties block helps nobody.
 *
 * Protected text the selection contains whole passes this check, because
 * both edges then look out onto ordinary live text.
 *
 * Trimming has already guaranteed that a real character sits at `from` and
 * another sits just before `to`. So on each edge only the neighbor facing
 * outward can be unknown, and only that side needs to be told whether a
 * region is hanging open there.
 */
function selectionCutsProtectedText(
    ctx: DocContext,
    from: EditorPosition,
    to: EditorPosition,
): boolean {
    const { lines } = ctx;
    const reading = ctx.reading();
    // Frontmatter always starts at line 0, so if the selection overlaps it
    // at all, the `from` edge must be inside it. Checking `from` is enough.
    const frontmatter = reading.protectedSpans.find((span) => span.kind === "frontmatter");
    if (frontmatter && from.line <= frontmatter.endLine) return true;
    // Whether a region that runs over several lines (a comment, math, or a
    // code fence, quoted ones included) is still open at the START of a
    // given line. A fence inside a blockquote counts too: found in a
    // 30,000-case soak, 2026-08-20, a full-line drag inside a quoted fence
    // converted the line, which dropped its quote marker and killed the
    // fence.
    const openInto = (line: number) => reading.regionOpenAt(line);
    // Suppose the line holding the `from` edge is protected but carries
    // none of those three flags. That is a legitimate edge in one case
    // only: the line is a fence OPENER, whose construct reaches DOWN into
    // the selection. Everything else in that state refuses. Examples:
    // indented code inside a blockquote, which starts with ">" at
    // character 0, so the whitespace trimming cannot keep the edge out of
    // it (the second find of the same 30,000-case soak, 2026-08-20); plus
    // indented code at the top level of the note, and openers that never
    // close.
    const fenceOpener = (line: number) =>
        line + 1 < lines.length
            ? reading.regionOpenAt(line + 1)
            : reading.openRegionFrom !== -1;
    if (
        reading.protectedLines[from.line] &&
        !openInto(from.line) &&
        !fenceOpener(from.line)
    ) {
        return true;
    }
    if (
        caretInsideMaskedSpan(
            ctx.maskedLine(from.line),
            from.ch,
            openInto(from.line),
            false, // the selection start sits ON a character, so its right-hand side is still on this line
        )
    ) {
        return true;
    }
    const openAtTo =
        to.line + 1 < lines.length ? openInto(to.line + 1) : reading.openRegionFrom !== -1;
    return caretInsideMaskedSpan(
        ctx.maskedLine(to.line),
        to.ch,
        false, // `to` follows a character - the before-side is on-line
        openAtTo,
    );
}

/**
 * Whether replacing the selection with `replacement` would change how
 * Obsidian reads any line the edit does not itself touch: the note reading
 * of the two texts, compared line by line (linesReadAlike).
 *
 * This is the check that catches a destroyed construct. A selection that
 * swallows a fence delimiter, or that closes or un-closes a region simply
 * by being removed, can leave a result that looks perfectly live. It looks
 * live precisely BECAUSE innocent text elsewhere in the note has just been
 * reclassified, and the checks that test whether the new reference and
 * definition are live cannot see that happen. A selection that takes one
 * of a "%%" comment's two lines un-closes it, and every line below
 * disappears into it (hunt 2026-10-03, pin
 * bug-cut-comment-delimiter-wrong-toast); a destroyed fence opener turns
 * its closer into the opener of a new fence.
 */
function replacementReclassifiesDoc(
    ctx: DocContext,
    from: EditorPosition,
    to: EditorPosition,
    replacement: string,
): boolean {
    const before = ctx.reading();
    const simulated = simulateChanges(ctx.lines, [
        { from, to, text: replacement },
    ]);
    const after = readNote(simulated);
    const delta = simulated.length - ctx.lines.length;
    for (let i = 0; i < from.line; i++) {
        if (!linesReadAlike(before, i, after, i, "none")) return true;
    }
    for (let i = to.line + 1; i < ctx.lines.length; i++) {
        if (!linesReadAlike(before, i, after, i + delta, "none")) return true;
    }
    return false;
}

/**
 * Turns `text` into a definition body.
 *
 * The first line goes on the label line itself. Every line after it
 * becomes a continuation line, indented four spaces. That is the shape the
 * note reading, the jump commands, and Obsidian's own renderer all read as
 * one footnote with several paragraphs.
 *
 * A line holding only whitespace becomes exactly four spaces. The reading
 * and the renderer both treat a whitespace-only line as blank, so it still
 * separates the paragraphs, but on screen it lines up with the
 * continuation indent instead of sitting ragged (Jason's ask, 2026-08-21).
 */
function indentDefinitionBody(text: string): string {
    // A first line that opens a code fence starts on the line after the
    // label, indented like the rest. Obsidian itself renders "[^1]: ```"
    // with an indented closer as a code block, but the hand-written scanner
    // the plugin read notes with until the runtime swap (2026-10-03) did not,
    // and every definition below it turned into code (Jason's report, sheet
    // 04, 2026-09-09). The note reading reads both shapes as Obsidian does,
    // so this is now only the shape the plugin writes. Every other block
    // construct - a heading, a table row, a list item, a quote, a rule, a
    // math block - renders on the label line in Obsidian (checked
    // 2026-09-09/10), so it stays there.
    const body = startsWithFence(text) ? `\n${text}` : text;
    return body
        .split("\n")
        .map((line, i) =>
            i === 0 ? line : line.trim() === "" ? "    " : `    ${line}`,
        )
        .join("\n");
}

/** Whether the first line of a selection opens a code fence. */
function startsWithFence(text: string): boolean {
    return /^ {0,3}(?:`{3,}|~{3,})/.test(text.split("\n")[0]);
}

/**
 * The modal's validation: the reason `name` cannot name the selection's
 * new footnote, or null when it can.
 *
 * A name that already has a definition is refused. The selected text needs
 * somewhere to live, and merging duplicate definitions is the merge rule's
 * job, not something creation should do behind your back.
 *
 * A name carried only by orphaned references is welcome, though. Those
 * references have no definition, and defining the name heals them.
 */
function namedSelectionProblem(
    doc: Editor,
    name: string,
    ctx: DocContext = docContext(doc),
): string | null {
    const problem = footnoteNameProblem(name);
    if (problem !== null) return problem;
    if (idListIncludes(listExistingFootnoteDefinitions(doc, ctx), name)) {
        return nameAlreadyUsed(name);
    }
    return null;
}

/**
 * The named conversion the modal runs when you submit it. Exported so the
 * unit tests can call it, since the modal itself is DOM work they cannot
 * reach.
 *
 * It checks the name against the document as it stands right now, then
 * confirms the selection it captured still holds the same text, because
 * the note can change while the modal sits open. Then it converts under
 * `name`, exactly as the numbered command would.
 *
 * It returns a problem string to show inside the modal, which stays open,
 * or null when the press is settled: either converted, or refused with a
 * notice of its own.
 */
export function convertSelectionToNamed(
    plugin: FootnotePlugin,
    doc: Editor,
    selection: ConvertedSelection,
    name: string,
): string | null {
    const ctx = docContext(doc);
    const problem = namedSelectionProblem(doc, name, ctx);
    if (problem !== null) return problem;
    if (
        selection.to.line >= doc.lineCount() ||
        rangeText(ctx.lines, selection.from, selection.to) !==
            selection.lead + selection.text + (selection.trail ?? "")
    ) {
        showNotice(SelectionChangedNotice, 8000);
        return null;
    }
    convertMainSelection(plugin, doc, selection, ctx, name);
    return null;
}

/** The same as convertSelectionToNamed, but for a selection inside a table cell's own editor. */
export function convertCellSelectionToNamed(
    plugin: FootnotePlugin,
    doc: Editor,
    cell: TableCellEditor,
    selection: CellSelection,
    name: string,
    cursorPosition?: EditorPosition,
): string | null {
    const problem = namedSelectionProblem(doc, name);
    if (problem !== null) return problem;
    const cellText = cell.state.doc.toString();
    if (cellText.slice(selection.from, selection.to) !== selection.lead + selection.text) {
        showNotice(SelectionChangedNotice, 8000);
        return null;
    }
    convertCellSelection(plugin, doc, cell, selection, cursorPosition, name);
    return null;
}

/**
 * The main editor's single usable selection, turned the right way round so
 * that `from` never comes after `to`.
 *
 * Returns null when nothing is selected, and "multi" when the selection
 * cannot be converted because there are several separate stretches of it:
 * one footnote cannot stand in for several disconnected pieces of text.
 *
 * A selection spanning lines is usable, and has been since 2026-08-19;
 * such a selection becomes a definition with several paragraphs.
 */
function normalizedMainSelection(
    doc: Editor,
): { from: EditorPosition; to: EditorPosition } | "multi" | null {
    const all = doc.listSelections();
    const ranges = all.filter(
        (range) => comparePositions(range.anchor, range.head) !== 0,
    );
    if (ranges.length === 0) return null;
    // One real selection plus one or more bare extra carets (shift-drag,
    // then Alt-click somewhere else) is just as ambiguous as two real
    // selections. The press used to convert the selection and quietly
    // throw the extra caret away, which is exactly the silent drop the
    // multi-caret press exists to prevent (hunt 2026-08-25,
    // bug-mixed-selection-extra-caret-dropped).
    if (ranges.length > 1 || all.length > ranges.length) return "multi";
    let from = ranges[0].anchor;
    let to = ranges[0].head;
    if (comparePositions(from, to) > 0) [from, to] = [to, from];
    return { from, to };
}

// The inline version: the selection is wrapped as "^[…]" where it sits,
// and the caret lands after the closing bracket. Single-line selections
// only; a selection spanning lines was already sent elsewhere at the entry
// point (2026-08-20).
//
// The content cleaner, shared with the paste key, collapses runs of
// whitespace and escapes unbalanced brackets, so that a bracket in your
// text cannot end the wrapper early.
//
// Then comes the same born-dead refusal that insertInlineText uses. A
// born-dead insertion is one that would not be a real footnote the moment
// it landed. So the new span has to survive on the masked twin of the
// simulated line. A selection inside protected text dies here, and so does
// one whose removal completes some construct around it. The refusal
// speaks in the selection's words, "the selection cuts through ... select
// all of it or none of it", never the caret's: what the user did was
// select, and that advice is the fix (Claude sweep 2026-09-13, a drag over
// one "%%" delimiter without its partner).
function convertMainSelectionToInline(
    plugin: FootnotePlugin,
    doc: Editor,
    selection: ConvertedSelection,
    ctx: DocContext,
): void {
    const text = `^[${sanitizeInlineFootnoteContent(selection.text)}]`;
    const simulated = contextOfLines(simulateChanges(ctx.lines, [{ from: selection.from, to: selection.to, text }]));
    const verdict = pressLineVerdict(ctx.reading(), simulated, [selection.from], text) ?? bareInsertionVerdict(simulated, [selection.from], text);
    if (refusedCreation(verdict, ProtectedSelectionNotice)) return;
    const after = { line: selection.from.line, ch: selection.from.ch + text.length };
    moveCursorAndSetJumpPoint(doc, selection.from, after, plugin, [
        { from: selection.from, to: selection.to, text },
    ]);
}

// The version that puts the text in a definition. Both the numbered key
// (which mints the next free number) and the named modal (which uses the
// name you typed) come through here. The selection is replaced by
// "[^name]" and the text moves into that footnote's definition body. The
// press then lands in the popup or jumps to the definition, whichever the
// settings say, exactly as createAutonumFootnote does.
//
// Simulating the edit and verifying the result matters more here than for
// a plain insertion, for two reasons. Deleting the selection can leave a
// construct hanging open, when its closing delimiter was part of what you
// selected. And the body carries whatever text you selected onto the
// definition line, which could be anything.
//
// A null name means the note's prefix is invalid; the notice explaining
// that has already been shown. The press still counts as handled.
function convertMainSelection(
    plugin: FootnotePlugin,
    doc: Editor,
    selection: ConvertedSelection,
    ctx: DocContext,
    footnoteId: string | null,
): void {
    if (footnoteId === null) return;
    const footnoteReference = referenceText(footnoteId);

    // A selection spanning lines becomes a body with several paragraphs:
    // continuation lines indented four spaces under the label
    // (2026-08-19).
    const body = indentDefinitionBody(selection.text);
    // The definition is planned against the note with the selection
    // already replaced (see planDefinitionAppend), so a section heading
    // the selection swallows is simply gone, and nothing the append does
    // can land inside the replaced stretch (the property-test find of
    // 2026-09-09, a drag across "# Footnotes", used to need a rule of its
    // own for that).
    const plan = planDefinitionAppend({
        lines: ctx.lines,
        edits: [{ from: selection.from, to: selection.to, text: footnoteReference }],
        footnoteId,
        plugin,
        body,
    });
    // The same verification createAutonumFootnote does, widened to cover a
    // body that was filled in ahead of time and may span lines: the new
    // definition block has to claim every one of those continuation lines.
    const verdict = verifyLiveFootnoteInsertion({
        before: ctx.reading(),
        lines: plan.final,
        anchors: [plan.edits[0].start],
        footnoteId,
        definitionLabelLine: plan.labelLine,
        definitionBodyExtraLines: body.split("\n").length - 1,
    });
    if (refusedCreation(verdict, ProtectedSelectionNotice)) return;

    landDefinitionBackedInsertion({
        plugin,
        doc,
        changes: plan.changes,
        origin: selection.from,
        footnoteId,
        definitionCursor: plan.cursor,
        afterReference: plan.edits[0].end,
        // A conversion creates a footnote, so the landing runs the same
        // after-creation lint that every other creation press gets (Jason
        // asked for that parity on 2026-08-25). The seeded body is how the
        // lint finds the new definition again after it has renumbered it
        // and moved it to the bottom. The usual trick, looking for the one
        // empty definition, cannot work here because a converted definition
        // is never empty. Without the seeded body the caret was left on
        // whatever text the lint's replacement put at its old spot (Jason's
        // report, 2026-08-26).
        seededBody: body,
    });
}

// The definition-backed version for a table cell you are actively
// editing. Both the numbered key and the named modal use it. The
// reference replaces the cell selection through the cell's own editor,
// while the pre-filled definition is appended outside the table. This
// mirrors createAutonumFootnote's cell branch, including its promise
// about refusals: when the cell replacement would be born-dead, no
// orphaned definition may be left behind.
function convertCellSelection(
    plugin: FootnotePlugin,
    doc: Editor,
    cell: TableCellEditor,
    selection: CellSelection,
    cursorPosition: EditorPosition | undefined,
    footnoteId: string | null,
): void {
    if (footnoteId === null) return;
    const footnoteReference = referenceText(footnoteId);
    if (
        !replaceInTableCell(cell, footnoteReference, selection.from, selection.to, footnoteReference.length, docContext(doc).reading().linkLabels)
    ) {
        return;
    }
    // The cell editor has written the reference back into the row by now,
    // and when that row is the note's LAST line the append point moved
    // with it: the context built above still holds the old row, and the
    // append landed inside the new one, splitting the reference and the
    // row (Kimi hunt cycle 3, 2026-09-16; the numbered cell press had the
    // same bug, sheet 05). So the note is read again here.
    const plan = planDefinitionAppend({ lines: docLines(doc), edits: [], footnoteId, plugin, body: selection.text });
    landCellDefinitionAppend({
        plugin,
        doc,
        definitionChanges: plan.changes,
        origin: cursorPosition ?? doc.getCursor(),
        footnoteId,
        definitionCursor: plan.cursor,
    });
}

/** What the name modal will convert when you submit it: the selection it captured, either from the main editor or from a table cell. */
type NamedSelectionTarget =
    | {
          kind: "main";
          selection: ConvertedSelection;
      }
    | {
          kind: "cell";
          cell: TableCellEditor;
          selection: CellSelection;
          cursorPosition?: EditorPosition;
      };

// A single text box for the footnote's name. Enter, or the Create button,
// converts the captured selection under whatever you typed. A name that is
// invalid, or one that is already taken, shows its reason inside the modal
// and leaves it open. This is the same shape as the rename and set-prefix
// modals. The validation and the conversion itself live in the exported
// functions above; what follows is just the wiring.
// Stryker disable all: this is modal DOM running against the live app.
// The unit tests cannot reach it, so the smoke tests cover it instead
// (the same policy RenameFootnoteModal follows).
class NameSelectionModal extends ValidatedTextModal {
    private plugin: FootnotePlugin;
    private doc: Editor;
    private target: NamedSelectionTarget;

    constructor(plugin: FootnotePlugin, doc: Editor, target: NamedSelectionTarget) {
        super(plugin.app, {
            title: "Name the footnote",
            fieldName: "Name",
            fieldDesc: `Replaces the selection with "[^name]" and moves the selected text into that footnote's definition.`,
            buttonText: "Create",
            placeholder: "Smith2019",
        });
        this.plugin = plugin;
        this.doc = doc;
        this.target = target;
    }

    onOpen() {
        // Register a small closure rather than `this`. submit() is
        // protected, and the one thing the registry needs is the ability
        // to call it. Only this modal takes part in the active-modal
        // arrangement; the base class knows nothing about it.
        registerActiveNameModal({
            submit: () => {
                this.submit();
            },
        });
        // The registry above only helps the command palette and
        // executeCommandById. A real keypress never reaches a global
        // hotkey while a modal is open, because the modal's scope owns the
        // keyboard (Jason's report 2026-08-22: "the dialog still only
        // closes with Enter").
        //
        // So register the commands' own key combinations on this scope:
        // the very keys that create footnotes now submit the modal. The
        // command ids come from the plugin's own registration, never from
        // a second list kept by hand, and Obsidian's Scope does the
        // matching, which is the one mechanism it offers for this.
        for (const commandId of this.plugin.editorCommandIds) {
            for (const hotkey of commandHotkeys(this.plugin.app, commandId)) {
                this.scope.register([...hotkey.modifiers], hotkey.key, (evt) => {
                    evt.preventDefault();
                    this.submit();
                    return false;
                });
            }
        }
        super.onOpen();
    }

    protected submit() {
        const name = this.value.trim();
        if (name === "") {
            this.close();
            return;
        }
        const problem =
            this.target.kind === "main"
                ? convertSelectionToNamed(
                      this.plugin,
                      this.doc,
                      this.target.selection,
                      name,
                  )
                : convertCellSelectionToNamed(
                      this.plugin,
                      this.doc,
                      this.target.cell,
                      this.target.selection,
                      name,
                      this.target.cursorPosition,
                  );
        if (problem !== null) {
            this.showProblem(problem);
            return;
        }
        this.close();
    }

    onClose() {
        registerActiveNameModal(null);
        super.onClose();
    }
}
// Stryker restore all
