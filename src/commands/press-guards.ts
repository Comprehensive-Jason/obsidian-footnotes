import { Editor, EditorPosition } from "obsidian";

import type FootnotePlugin from "../main";
import { emptyReferenceStart, referenceText } from "../parsing/footnote-grammar";
import { footnotePrefixFromEditor, footnotePrefixProblem } from "../parsing/footnote-prefix";
import {
    exitInlineFootnoteIfInside,
    warnEmptyInlineFootnoteIfInside,
} from "./inline-footnotes";
import {
    caretInsideMaskedSpan,
    onLinkDefinition,
    ProtectedCreationNotice,
} from "../editor/insertion-liveness";
import { DocContext, docLines, insideDefinition } from "../editor/doc-context";
import { readNote } from "../parsing/note-reading";
import { maskInlineRegions } from "../parsing/cell-reading";
import { cellLinkLikeEndAt, linkLikeEndAt } from "../parsing/landing";
import {
    cellCaret,
    isTableDelimiterRow,
    TableCellEditor,
    tableRowCellSpans,
} from "../editor/table-cursor";

import { BlockSyntaxNotice, InsideLinkNotice, NestedFootnoteNotice, NoFootnoteCreated, showNotice } from "../editor/notice";
// The press guards. A footnote key has been pressed: does anything OTHER
// than creation own this press? An empty placeholder gets a warning, a
// filled inline footnote hops the caret out of itself, and protected text,
// which includes the inside of a definition, refuses the press outright.
// Split out of the all-in-one commands file 2026-08-12: one subject, sitting
// one step lower down than the command cascade that calls it.

/**
 * The caret guards that every footnote command runs before it acts. THE
 * ORDER IS LOAD-BEARING; here it is, with what each step is for and what
 * goes wrong if it moves:
 *
 *  1. An EMPTY inline footnote asks for its text. This must come first,
 *     otherwise the "done typing" hop below fires on it instead.
 *  2. A filled inline footnote hops the caret past its closing bracket.
 *     This must beat the reference guards below, because an inline
 *     footnote's body can itself contain reference-shaped text.
 *  3. An abandoned "[^]" asks for a name, rather than having a new
 *     footnote nested inside its brackets.
 *  4. An untouched "[^7-]" prefix placeholder asks for a suffix.
 *
 * True means the press was used up, by a toast or by a hop, and the
 * command stops there.
 *
 * The inline and paste commands also navigate out of a real reference
 * (navigateReferenceIfInside), which they do at their own call sites. The
 * numbered and named commands run their own jump cascade instead.
 *
 * `cursorPosition` is the RESOLVED caret. The numbered and named commands
 * call this from inside runOutsideTableCell's callback, whose sub-editor
 * fallback works out the real position. The guards used to run before that,
 * on a stale getCursor() (2026-08-11 review bug #9).
 */
export function caretGuardsHandled(
    plugin: FootnotePlugin,
    doc: Editor,
    cell: TableCellEditor | null,
    cursorPosition?: EditorPosition,
): boolean {
    if (warnEmptyInlineFootnoteIfInside(doc, cell, cursorPosition)) return true;
    if (exitInlineFootnoteIfInside(doc, cell, cursorPosition)) return true;
    if (warnEmptyReferenceIfInside(doc, cell, cursorPosition)) return true;
    if (warnPrefilledReferenceIfInside(plugin, doc, cell, cursorPosition)) {
        return true;
    }
    return false;
}

/**
 * Creating a footnote is blocked when the caret sits inside protected text:
 * code, math, a comment, or frontmatter (Jason's rule 2026-08-12, always
 * on, and inline spans count too). A reference put there would be dead
 * text that Obsidian never renders, and the next lint's orphan handling
 * would then delete it.
 *
 * This only runs at the CREATION steps. Navigation never reaches protected
 * text at all, because its own checks against the masked twin (the copy of
 * the note with protected text blanked out) fall through first. True means
 * the user was warned and the press is used up.
 */
export function warnProtectedCaretIfInside(
    doc: Editor,
    cell: TableCellEditor | null,
    cursorPosition: EditorPosition,
    ctx: DocContext,
): boolean {
    let inside: boolean;
    if (cell) {
        // a cell's text is a single line, so masking that one line is enough
        const cellText = cell.state.doc.toString();
        // a caret inside a link, a wikilink, or a web address is not in
        // protected text: the landing walk steps out past the construct
        // (Jason's landing rulings 2026-09-15), and a landing that stays
        // inside is caught by the born-dead check afterwards. The masked
        // twin blots link destinations and addresses since 2026-09-16
        // (Kimi hunt cycle 1), which is why this is spelled out here.
        // A reference link in the cell is a link when the note defines
        // its label, so the note's labels go along (hunt 2026-10-05,
        // round 2, pin bug-cell-defined-reference-link-press).
        if (cellLinkLikeEndAt(cellText, cellCaret(cell), ctx.reading().linkLabels) !== -1) return false;
        inside = caretInsideMaskedSpan(
            maskInlineRegions(cellText),
            cellCaret(cell),
            false,
            false,
        );
    } else {
        const reading = ctx.reading();
        const line = cursorPosition.line;
        const lineProtected = reading.protectedLines[line] ?? false;
        if (!lineProtected && caretInBlockSyntax(ctx, cursorPosition)) {
            showNotice(BlockSyntaxNotice, 8000);
            return true;
        }
        // the same allowance for a caret inside a link on an ordinary line
        if (!lineProtected && linkLikeEndAt(reading, line, cursorPosition.ch) !== null) {
            return false;
        }
        // right at the start or end of a line, whether the caret is
        // "inside" depends on whether an open region crosses that edge. A
        // caret at position 0 of the line that CLOSES a comment, or at the
        // end of a line whose tail opened a region, is inside that region
        // even though the character next to it is on another line.
        const openAtStart = reading.regionOpenAt(line);
        const openAtEnd =
            line + 1 < ctx.lines.length
                ? reading.regionOpenAt(line + 1)
                : reading.openRegionFrom !== -1;
        inside =
            lineProtected ||
            caretInsideMaskedSpan(
                ctx.maskedLine(line),
                cursorPosition.ch,
                openAtStart,
                openAtEnd,
            );
    }
    if (!inside) return false;
    // The address and title of a link reference definition ("[ref]:
    // http://u "Title"") are protected text too, but what a press there
    // would break is a link, so it gets the link notice, as a press on the
    // definition's label does through the "link" verdict
    // (pressLineVerdict). A caret after the label of one whose address is
    // on the next line is inside it as well (Jason's triage decision Q4,
    // 2026-10-05; hunt 2026-10-05, round 2, pin
    // spec-link-definition-address-notice).
    showNotice(!cell && onLinkDefinition(ctx.reading(), cursorPosition.line) ? InsideLinkNotice : ProtectedCreationNotice, 8000);
    return true;
}

/**
 * Whether the caret sits in the block syntax at the start of its line: in
 * front of or inside a quote marker, a list marker, a task box, or a
 * heading's "#" marks, or anywhere on a thematic break or a setext
 * underline. A footnote written there breaks the line's formatting:
 * "[^1]- item" is no list item, "[^1]> text" drops out of its quote,
 * "#[^1]# Heading" is no heading, and "==[^1]=" no longer makes the line
 * above a heading. So the press refuses (Jason's rulings 4 and 5,
 * 2026-09-20, extended on 2026-10-03 to every kind of block syntax).
 *
 * The note reading says where each line's text starts inside its
 * containers, so this is one rule for every shape, and a dash that starts
 * no list item ("-5 degrees") is text like any other. A line inside a
 * definition is left to the nesting guard, which refuses every press
 * there with its own notice.
 */
function caretInBlockSyntax(ctx: DocContext, cursorPosition: EditorPosition): boolean {
    const reading = ctx.reading();
    if (cursorPosition.ch >= reading.blockSyntaxEnd(cursorPosition.line)) return false;
    return reading.definitionAt(cursorPosition.line) === null;
}

/** For an untouched "[^7-]" placeholder: the prefix is there, the name is not. */
export const PrefixOnlyNotice =
    "This footnote reference has only the prefix. Type a name after it.";

/**
 * Creating a footnote is blocked anywhere inside a definition block: in the
 * body after the label, and on continuation lines. Obsidian does technically
 * render a footnote nested inside a definition, but that is wildly
 * nonstandard markdown and the plugin will not create it, and the popup's
 * embed mis-renders such definitions anyway (Jason's ruling 2026-08-13).
 *
 * A press on the label line before the end of the label never gets this
 * far: the navigation guards own those. A table cell never holds a real
 * definition. True means the user was warned and the press is used up.
 */
export function warnDefinitionCaretIfInside(
    doc: Editor,
    cell: TableCellEditor | null,
    cursorPosition: EditorPosition,
    ctx: DocContext,
): boolean {
    if (cell) return false;
    if (!insideDefinition(ctx, cursorPosition.line)) return false;
    showNotice(NestedFootnoteNotice, 8000);
    return true;
}

const TableEdgeNotice =
    NoFootnoteCreated + "the caret is at the edge of a table row, outside its cells. Put it inside a cell.";
const TableDelimiterNotice =
    NoFootnoteCreated + "the caret is on the row of dashes under a table's header. Put it inside a cell.";

/**
 * When the caret sits on a table row but outside every cell, or anywhere on
 * the row of dashes under the header: leave the caret alone, explain with a
 * Notice, and report true.
 *
 * This is the main-editor path, which Source mode and a caret placed
 * without entering a cell take; a caret inside a cell's own editor goes
 * through the cell and never gets here. A reference written past the
 * closing pipe is a cell beyond the header count, which Obsidian drops, so
 * the footnote never renders and its definition is orphaned on arrival;
 * one written before the opening pipe pushes the last cell out of the
 * table; one written into the dashes ends the table. Selections doing
 * the same are refused already (Jason's ruling 2026-09-04); the caret
 * press had no such check (Kimi sweep 2026-09-13).
 */
export function warnTableEdgeCaretIfOutside(
    cell: TableCellEditor | null,
    cursorPosition: EditorPosition,
    ctx: DocContext,
): boolean {
    if (cell) return false;
    const lineText = ctx.lines[cursorPosition.line] ?? "";
    // a table row always has a pipe, and reading the whole note's rows is
    // not free, so a line without one is settled here
    if (!lineText.includes("|")) return false;
    if (!ctx.reading().tableRowLines[cursorPosition.line]) return false;
    if (isTableDelimiterRow(lineText)) {
        showNotice(TableDelimiterNotice, 8000);
        return true;
    }
    const ch = cursorPosition.ch;
    if (tableRowCellSpans(lineText).some((span) => span.from <= ch && ch <= span.to)) return false;
    showNotice(TableEdgeNotice, 8000);
    return true;
}

// (navigateDefinitionLabelIfInside used to live here, 2026-08-12/13: the
// label-only navigation for the two inline commands. Jason's ruling
// superseded it. The inline commands now run the SAME whole-block jump step
// as the numbered and named keys, shouldJumpFromDefinitionToReference,
// wired in at their own entry points.)

/**
 * When the caret sits inside an untouched prefilled reference, that is a
 * "[^7-]" holding exactly the note's footnote prefix with no name typed
 * after it yet: leave the caret where it is, ask for a name with a Notice,
 * and report true.
 *
 * A prefilled reference is the prefix version of the empty "[^]"
 * placeholder, and a press inside it must never create a footnote named
 * after the bare prefix. It used to hop the caret out instead, the way
 * "[^]" does, but staying put with an explanation is easier to understand
 * (2026-08-05).
 */
export function warnPrefilledReferenceIfInside(
    plugin: FootnotePlugin,
    doc: Editor,
    cell: TableCellEditor | null,
    cursorPosition?: EditorPosition,
): boolean {
    if (!plugin.settings.enableFootnotePrefix) return false;
    // a cheap check before doing any real work on the document: no "[^" on
    // the line means there is no placeholder to warn about, and this guard
    // runs on EVERY command press
    const rawText = cell
        ? cell.state.doc.toString()
        : doc.getLine((cursorPosition ?? doc.getCursor()).line);
    if (!rawText.includes("[^")) return false;
    const prefix = footnotePrefixFromEditor(doc);
    // check the prefix is valid, but say nothing about it here. Complaining
    // about an invalid prefix is the insert path's job, not something every
    // caret guard should do.
    if (!prefix || footnotePrefixProblem(prefix) !== null) return false;
    const placeholder = referenceText(prefix);
    if (!caretInsidePlaceholder(doc, cell, placeholder, cursorPosition)) {
        return false;
    }
    showNotice(PrefixOnlyNotice);
    return true;
}

/**
 * Whether the caret sits strictly inside a live occurrence of
 * `placeholder`, which is either "[^]" or the prefilled "[^7-]". It looks
 * in the table cell's text, or on the caret's own line.
 *
 * Case does not matter, as it does not for any footnote name in
 * Obsidian: under the prefix "p.", "[^P.]" is the placeholder just as
 * "[^p.]" is, and a press inside it created a definition named after the
 * bare prefix (hunt 2026-10-02, pin bug-press-prefilled-placeholder-case).
 *
 * A hit on the raw line is confirmed against the masked text before it
 * counts. Placeholder-shaped text inside inline code or a code fence is
 * just plain text (#41 semantics), and warning about it would block a
 * perfectly good insertion. Checking the raw line first keeps the
 * whole-document masking out of the hot path, since this runs on every
 * press.
 */
function caretInsidePlaceholder(
    doc: Editor,
    cell: TableCellEditor | null,
    placeholder: string,
    cursorPosition?: EditorPosition,
): boolean {
    const inside = (text: string, ch: number) => emptyReferenceStart(lowerCased(text), ch, lowerCased(placeholder)) !== null;
    if (cell) {
        const head = cellCaret(cell);
        const cellText = cell.state.doc.toString();
        if (!inside(cellText, head)) return false;
        // a cell's text is a single line, so masking that one line is enough
        return inside(maskInlineRegions(cellText), head);
    }
    const pos = cursorPosition ?? doc.getCursor();
    if (!inside(doc.getLine(pos.line), pos.ch)) return false;
    return inside(readNote(docLines(doc)).maskedLine(pos.line), pos.ch);
}

/**
 * `text` in lower case, character by character, except a character whose
 * lower case is longer than itself (the Turkish dotted capital I is one),
 * so every column of `text` is the same column of the result.
 */
function lowerCased(text: string): string {
    return text.replace(/[\s\S]/gu, (c) => (c.toLowerCase().length === c.length ? c.toLowerCase() : c));
}

/**
 * When the caret sits inside an abandoned empty reference "[^]", leave the
 * caret where it is, ask for a name with a Notice, and report true. Every
 * footnote command shares this (QOL sweep, 2026-08-07).
 *
 * Why it is needed: "[^]" is invisible to the patterns that find
 * references, because they all require a name of at least one character.
 * Without this guard the numbered and inline commands nested their
 * insertion INTO the brackets ("[^[^1]]"), and the named command silently
 * hopped the caret out. A warning is the only response that tells the user
 * what that fragment is and how to finish it.
 */
function warnEmptyReferenceIfInside(
    doc: Editor,
    cell: TableCellEditor | null,
    cursorPosition?: EditorPosition,
): boolean {
    if (!caretInsidePlaceholder(doc, cell, "[^]", cursorPosition)) return false;
    showNotice(
        "This footnote reference is empty. Type a name between the brackets.",
        8000,
    );
    return true;
}
