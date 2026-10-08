import { noteSplitCreation } from "../editor/undo-orphan-notice";
import {
    Editor,
    EditorChange,
    EditorPosition,
} from "obsidian";

import type FootnotePlugin from "../main";
import {
    computeNextFootnoteNumber,
    emptyReferenceStart,
    footnoteNameProblem,
    idListIncludes,
    InvalidNameCharacters,
    quotedReference,
    referenceText,
} from "../parsing/footnote-grammar";
import { openFootnotePopup, popupEditingAvailable } from "./footnote-popup";
import { jumpToFootnoteDefinition } from "./navigation";
import { activeFootnotePrefix, footnotePrefixFromEditor } from "../parsing/footnote-prefix";
import { adjustFootnotePosition, cellInFrontOfTakenPunctuation, endOfWordOffset, moveCursorAndSetJumpPoint } from "../editor/cursor-motion";
import { cellImageStarts, cellLinkLikeEndAt } from "../parsing/landing";
import { planDefinitionAppend } from "./definition-append";
import {
    DocContext,
    docContext,
    docLines,
    listExistingFootnoteDefinitions,
    referenceOccurrenceAtCursor,
} from "../editor/doc-context";
import { ProtectedCreationNotice, safeInsertionCh, simulateChanges } from "../editor/insertion-liveness";
import { lintAfterFootnoteCreation } from "../linting/linter";
import { maskInlineRegions, readCell } from "../parsing/cell-reading";
import { warnDefinitionCaretIfInside, warnTableEdgeCaretIfOutside, warnProtectedCaretIfInside } from "./press-guards";
import { cellCaret, TableCellEditor } from "../editor/table-cursor";

import { BlockSyntaxNotice, DeadFootnoteNotice, InsideLinkNotice, NestedFootnoteNotice, ReadsDifferentlyNotice, showNotice } from "../editor/notice";
import { CreatedFootnote, GateReason, GateVerdict, judgeEdit } from "../editor/result-gate";

/**
 * Shows the notice for a creation the result gate refused (judgeEdit in
 * result-gate.ts), and reports whether it refused. Each reason the gate
 * gives has its notice (the design's table; Jason, 2026-10-08): a
 * footnote inside a footnote gets the nesting notice, the one a caret
 * inside a definition gets; protected text, the protected-text notice; a
 * link, the link notice (Jason's ruling, 2026-10-04); a line's
 * formatting, the block-syntax notice (Jason, 2026-10-05); something the
 * press meant to create that would not be live for any other reason, its
 * own notice (ruling 7 of the cycle 6 rulings, 2026-10-08; it borrowed the
 * protected-text notice until then); and anything else, the general one. A selection conversion speaks in its own words for some
 * reasons, and hands them in as `notices`. Shared by every press that
 * creates a footnote. True means the press was refused.
 */
export function refusedCreation(verdict: GateVerdict, notices: Partial<Record<GateReason, string>> = {}): boolean {
    if (verdict.pass) return false;
    const byReason: Record<GateReason, string> = {
        nested: NestedFootnoteNotice,
        protected: ProtectedCreationNotice,
        link: InsideLinkNotice,
        formatting: BlockSyntaxNotice,
        dead: DeadFootnoteNotice,
        other: ReadsDifferentlyNotice,
        ...notices,
    };
    showNotice(byReason[verdict.reason], 8000);
    return true;
}

// The creation steps of the cascade. The cascade is the ordered list of
// steps a press falls through, each one either handling the press or
// passing it along. These are the steps that make a footnote: mint a
// reference, append its definition, then hand off to the popup or jump to
// the definition. Every step hands the note as its edit would leave it to
// the result gate (result-gate.ts) before any edit is sent to the editor.
//
// Apart from the wiring in main.ts, this module is the only place that
// imports the linter, because creation is where the lint-on-creation
// trigger fires. Split out of the one big commands file on 2026-08-12.

// Inserts `text` at the caret of a table cell you are actively editing.
// It goes through the cell's own editor, so the table widget takes care of
// writing the markdown back. It honors the end-of-word setting, and leaves
// the cell's caret `caretOffsetInText` characters into the text it
// inserted, with focus still in the cell.
//
// Returns false when the result gate refused the insertion (see
// dispatchCellEditIfLive). Nothing at all is written in that case, so
// code that pairs this with a definition append must skip the append too.
//
// `linkLabels` are the labels of the note's link reference definitions
// ("[ref]: http://u"). The cell editor holds the cell's text only, and a
// "[some text]" in it is a link when the note defines its label, so the
// press needs them to step over such a link instead of splitting it
// (hunt 2026-10-05, round 2, pin bug-cell-defined-reference-link-press).
export function insertInTableCell(
    cell: TableCellEditor,
    plugin: FootnotePlugin,
    text: string,
    caretOffsetInText: number,
    linkLabels: ReadonlySet<string> = new Set(),
): boolean {
    const cellText = cell.state.doc.toString();
    const head = cellCaret(cell);
    // safeInsertionCh nudges the insertion point, the same way
    // adjustFootnotePosition does. Text inserted right after an escaping
    // backslash, or right after a bare "^", gets swallowed by it
    // (bug-insert-after-backslash).
    let landing = head;
    if (plugin.settings.insertAtEndOfWord) {
        landing = endOfWordOffset(
            cellText,
            head,
            plugin.settings.footnotePlacement,
            cellLinkLikeEndAt(cellText, head, linkLabels),
            cellImageStarts(cellText, linkLabels),
        );
        // A press after the period that ends an email address lands in
        // front of the period, as it does in a paragraph, unless the
        // placement is Don't move (Jason's ruling Q30, 2026-10-08; hunt
        // 2026-10-08 cycle 7, cluster Y11, pin
        // bug-table-cell-press-after-email-period).
        if (plugin.settings.footnotePlacement !== "none") landing = cellInFrontOfTakenPunctuation(cellText, landing);
    }
    const at = safeInsertionCh(cellText, landing);
    return dispatchCellEditIfLive(cell, text, at, at, caretOffsetInText, linkLabels);
}

/**
 * Replaces the range `from` up to `to` inside a table cell you are
 * actively editing with `text`. This is how a conversion writes into a
 * cell (issue #35). The result gate judges it just as it judges
 * insertInTableCell's text (`linkLabels` are the note's link labels, as
 * there). `conversion` says what the conversion moves into a definition
 * (`body`, none for an inline footnote, whose text stays in the cell) and
 * the notices it refuses with in its own words. The range being replaced
 * is the cell's own selection, so the end-of-word adjustment does not
 * apply here.
 */
export function replaceInTableCell(
    cell: TableCellEditor,
    text: string,
    from: number,
    to: number,
    caretOffsetInText: number,
    linkLabels: ReadonlySet<string> = new Set(),
    conversion: { body?: string; notices: Partial<Record<GateReason, string>> } = { notices: {} },
): boolean {
    return dispatchCellEditIfLive(cell, text, from, to, caretOffsetInText, linkLabels, conversion);
}

// The one place cell writes happen. The result gate judges the edit
// (cellVerdict), and a refused one is not written; otherwise it goes
// through the cell's own editor, leaving the caret inside what it just
// wrote. Never the main editor: a main-editor write races the cell's own
// write-back and corrupts the table.
function dispatchCellEditIfLive(
    cell: TableCellEditor,
    text: string,
    from: number,
    to: number,
    caretOffsetInText: number,
    linkLabels: ReadonlySet<string>,
    conversion: { body?: string; notices: Partial<Record<GateReason, string>> } = { notices: {} },
): boolean {
    const cellText = cell.state.doc.toString();
    // a range from a stale selection is clamped the same way the caret is
    from = Math.max(0, Math.min(from, cellText.length));
    to = Math.max(from, Math.min(to, cellText.length));
    if (refusedCreation(cellVerdict(cellText, text, from, to, caretOffsetInText, linkLabels, conversion.body), conversion.notices)) return false;
    cell.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + caretOffsetInText },
    });
    return true;
}

/**
 * The result gate's verdict on writing `text` over `from` up to `to` of a
 * table cell whose text is `cellText`. The cell editor holds the cell's
 * text alone, so the gate judges the cell as the one row of a table, with
 * the note's link reference definitions under it (`linkLabels`: a "[some
 * text]" in a cell is a link when the note defines its label) and, for a
 * conversion, the definition it writes after them holding `body`, the
 * selected text, as the note's own definition would. The edit can finish
 * off a construct that was sitting around it, and so be swallowed into that
 * construct the moment it is born (a pair of "$" signs closing into inline
 * math, the command-press property suite, 2026-08-12); it can cut a link
 * short or a code span in half; and a selection holding a footnote would
 * put it inside the new one. The cell is read as the note holds it
 * (readCell), where a "|" in the text is written "\|", so the text is
 * judged in its written form. What `text` is comes from its shape and the
 * caret: an inline footnote ("^[...]", its text the clipboard's when it is
 * written at the caret and holds some), an empty placeholder (the caret
 * left inside it), or a reference.
 */
function cellVerdict(cellText: string, text: string, from: number, to: number, caretOffsetInText: number, linkLabels: ReadonlySet<string>, body?: string): GateVerdict {
    const after = readCell(cellText.slice(0, from) + text + cellText.slice(to));
    const start = after.column(from);
    const written = after.line.slice(start, after.column(from + text.length));
    const at = [{ line: 0, ch: start }];
    const links = [...linkLabels].map((label) => `[${label}]: https://example.com`);
    const note = (line: string, definition: string[]) => [line, "| --- |", "", ...links, ...definition];
    let created: CreatedFootnote;
    let definition: string[] = [];
    if (written.startsWith("^[")) {
        created = { kind: "inline", text: written, at, fromOutside: from === to && written !== "^[]" };
    } else if (caretOffsetInText < text.length) {
        created = { kind: "placeholder", text: written, at };
    } else {
        const name = written.slice(2, -1);
        if (body !== undefined) definition = ["", `[^${name}]: ${body}`];
        created = { kind: "footnote", name, references: at, ...(body !== undefined ? { definition: { line: 4 + links.length, lines: 1 } } : {}) };
    }
    return judgeEdit(note(readCell(cellText).line, []), note(after.line, definition), { created: [created] });
}

/**
 * Counts which of `footnoteId`'s references the caret is on, reading the
 * note from top to bottom. 0 means the first one. The caret counts as on a
 * reference when it sits inside it or immediately after it. When the caret
 * is on none of them, this returns 0 as well, falling back to the first
 * reference.
 *
 * Why a count and not a position: the order of a name's references does
 * not change when lint runs. The rules rename references where they stand,
 * they move whole definition blocks only, and the punctuation rule only
 * ever swaps a reference with the punctuation next to it. So this count
 * survives a lint, while the caret's line and column do not (see
 * openPopupForNewDefinition).
 *
 * Exported so the unit tests can call it. Fakes do not count, as in every
 * reference scan: reference-shaped text inside a code span is not a
 * footnote.
 */
export function referenceOrdinalAtCursor(
    doc: Editor,
    footnoteId: string,
    cursor: EditorPosition,
    ctx: DocContext = docContext(doc),
): number {
    const wanted = footnoteId.toLowerCase();
    let ordinal = 0;
    for (let line = 0; line <= cursor.line && line < ctx.lines.length; line++) {
        for (const occurrence of ctx.reading().referencesOn(line)) {
            if (occurrence.name.toLowerCase() !== wanted) continue;
            if (line === cursor.line) {
                if (cursor.ch > occurrence.start && cursor.ch <= occurrence.end) {
                    return ordinal;
                }
                // A reference that ends past the caret is not the one the
                // caret is on, and does not come before it either, so it
                // must not be counted.
                if (occurrence.end > cursor.ch) continue;
            }
            ordinal++;
        }
    }
    return 0;
}

/** The position just past `footnoteId`'s reference number `ordinal`, counting from the top of the note, or null when the note has fewer than that. This is the half that puts the caret back after referenceOrdinalAtCursor counted it. Exported so the unit tests can call it. */
export function positionAfterReference(
    doc: Editor,
    footnoteId: string,
    ordinal: number,
    ctx: DocContext = docContext(doc),
): EditorPosition | null {
    const wanted = footnoteId.toLowerCase();
    let seen = 0;
    for (let line = 0; line < ctx.lines.length; line++) {
        for (const occurrence of ctx.reading().referencesOn(line)) {
            if (occurrence.name.toLowerCase() !== wanted) continue;
            if (seen === ordinal) return { line, ch: occurrence.end };
            seen++;
        }
    }
    return null;
}

/**
 * The next free number as a footnote name, carrying the note's prefix if
 * it has one. Returns null when the prefix is invalid; the notice
 * explaining why has already been shown.
 *
 * The prefix is read from the frontmatter alone rather than from the whole
 * note. Joining every line together built the entire document on each
 * press just to read its first few lines (a performance item from the
 * 2026-08-11 review).
 *
 * The numbering reads the note's footnotes from the press's own reading,
 * so a number inside code reserves nothing.
 *
 * Three places used to work this out for themselves; this is now the one
 * home for it (duplicated-logic audit, 2026-09-05).
 */
export function autonumFootnoteId(
    plugin: FootnotePlugin,
    doc: Editor,
    ctx: DocContext = docContext(doc),
): string | null {
    const prefix = activeFootnotePrefix(plugin, footnotePrefixFromEditor(doc));
    if (prefix === null) return null;
    return `${prefix}${computeNextFootnoteNumber(ctx.reading(), prefix)}`;
}

// Stryker disable all: this hands off to the popup against the live
// workspace, which the unit tests cannot reach, so the smoke tests cover
// it. Confirmed by the 2026-08-12 re-baseline: every mutant in this
// function came back as no-coverage.
/**
 * The last step of a creation press that ends in the popup: lint first,
 * then open the popup editor on the new definition.
 *
 * The lint used to wait until the popup was closing, which left the note
 * visibly unlinted for as long as the popup was up (Jason's ask
 * 2026-08-27). Linting before the popup attaches itself also removes the
 * danger that waiting was there to avoid, namely a lint renaming the
 * footnote out from under an open popup. The popup now opens on the name
 * the footnote has AFTER the lint (lintAfterFootnoteCreation hands back
 * the new name; see what it promises).
 *
 * If the popup cannot open, because Obsidian's embed registry is not
 * available or something fails late, the press jumps to the definition
 * instead. It jumps by NAME, because the `definitionCursor` position was
 * worked out before the lint and the lint may have moved or renumbered the
 * definition since. Those raw coordinates are the last resort, used only
 * when even the lookup by name fails.
 *
 * Every insertion that comes with a definition arrives here through
 * landDefinitionBackedInsertion below (unified 2026-08-25).
 */
function openPopupForNewDefinition(
    plugin: FootnotePlugin,
    doc: Editor,
    cursorPosition: EditorPosition,
    footnoteId: string,
    definitionCursor: EditorPosition,
    seededBody?: string,
) {
    const ordinal = referenceOrdinalAtCursor(doc, footnoteId, doc.getCursor());
    const relocated = lintAfterFootnoteCreation(plugin, doc, false, seededBody);
    const effectiveId = relocated ?? footnoteId;
    if (relocated !== null) {
        // The lint changed the note. It rewrites as little text as it can,
        // and a caret that was inside the one stretch it rewrote comes out
        // at the START of that stretch, which reads as the first
        // renumbered footnote (Jason's report 2026-08-27). The popup
        // anchors itself at the caret and gives the caret back when it
        // closes, so put the caret somewhere meaningful first: just past
        // the same-numbered reference, under whatever name it now has.
        const restored = positionAfterReference(doc, effectiveId, ordinal);
        if (restored) doc.setCursor(restored);
    }
    void openFootnotePopup(plugin, effectiveId, () => {
        if (!jumpToFootnoteDefinition(effectiveId, cursorPosition, plugin, doc)) {
            moveCursorAndSetJumpPoint(doc, cursorPosition, definitionCursor, plugin, undefined, true);
        }
    });
}
// Stryker restore all

/**
 * The landing every main-editor insertion that comes with a definition
 * goes through. The landing is where a creation press hands off once its
 * edit is done. Before 2026-08-25 the single-caret press, the multi-caret
 * press, and the conversion each had their own copy of this code.
 *
 * It applies `changes` and then shows you the new definition, one of two
 * ways. In the popup: the caret parks just past the new reference, and
 * openPopupForNewDefinition lints first and attaches the popup to the name
 * the footnote has afterwards. Or by jumping to `definitionCursor` and
 * linting, putting the caret back afterwards.
 *
 * Both ways run the creation lint from here, following Jason's ruling that
 * they should behave alike (2026-08-25, and the popup arm moved its lint
 * earlier on 2026-08-27): anything that creates a footnote lints, if the
 * setting says to.
 *
 * `seededBody` is the exact definition body a conversion wrote. It is how
 * the lint finds the new footnote again after renumbering or moving it.
 * A plain insertion does not need it, because its definition is the only
 * empty one in the note.
 *
 * Creations inside a table cell do not come here (see
 * landCellDefinitionAppend).
 */
export function landDefinitionBackedInsertion(opts: {
    plugin: FootnotePlugin;
    doc: Editor;
    changes: EditorChange[];
    /** Where the press began. Closing the popup and jumping both come back here. */
    origin: EditorPosition;
    footnoteId: string;
    /** Where in the definition the caret should end up, in line numbers as they will be once the edit has been applied. */
    definitionCursor: EditorPosition;
    /** Where the caret parks on the popup route: just past the new reference. Left out by createMatchingFootnoteDefinition, which only appends a definition and whose caret already sits on the reference. */
    afterReference?: EditorPosition;
    /** The definition body a conversion wrote, from the label line onward, continuation indent included. Left out by every press that creates an empty definition. */
    seededBody?: string;
}): void {
    // Stryker disable next-line ConditionalExpression, BlockStatement: the unit tests all run with the popup off, so which route is taken is only ever checked by the smoke tests, and the full smoke suite drives both
    if (popupEditingAvailable(opts.plugin)) {
        // Stryker disable all: this is the popup route. The unit tests all
        // run with the popup off, so mutants here are no-coverage noise;
        // the smoke tests cover it (verified 2026-08-12).
        opts.doc.transaction(
            opts.afterReference
                ? {
                      changes: opts.changes,
                      selection: { from: opts.afterReference },
                  }
                : { changes: opts.changes },
        );
        openPopupForNewDefinition(
            opts.plugin,
            opts.doc,
            opts.origin,
            opts.footnoteId,
            opts.definitionCursor,
            opts.seededBody,
        );
        // Stryker restore all
    } else {
        moveCursorAndSetJumpPoint(
            opts.doc,
            opts.origin,
            opts.definitionCursor,
            opts.plugin,
            opts.changes,
            true,
        );
        lintAfterFootnoteCreation(opts.plugin, opts.doc, true, opts.seededBody);
    }
}

/**
 * The landing for creations inside a table cell, shared by the numbered
 * cell insertion and the cell conversion.
 *
 * By the time this runs, the reference has already been written through
 * the cell's own editor, never the main editor, because a main-editor
 * write races the cell's write-back (issue #28). So the only thing that
 * touches the main editor here is the definition.
 *
 * Neither route runs the creation lint: a creation inside a table cell
 * skips the trigger altogether (see what lintAfterFootnoteCreation
 * promises).
 */
export function landCellDefinitionAppend(opts: {
    plugin: FootnotePlugin;
    doc: Editor;
    definitionChanges: EditorChange[];
    origin: EditorPosition;
    footnoteId: string;
    definitionCursor: EditorPosition;
}): void {
    // the reference is already in the cell (one history step); the
    // definition below is the next one - the partial-undo notice may
    // promise that a second undo removes the reference too, for the undo
    // that brings the note back to the text it has right now
    noteSplitCreation(opts.footnoteId, opts.doc.getValue());
    // Stryker disable next-line ConditionalExpression, BlockStatement: the unit tests all run with the popup off, so which route is taken is only ever checked by the smoke tests, and the full smoke suite drives both
    if (popupEditingAvailable(opts.plugin)) {
        // Stryker disable all: this is the popup route. The unit tests all
        // run with the popup off, so mutants here are no-coverage noise;
        // the smoke tests cover it (verified 2026-08-12).
        opts.doc.transaction({ changes: opts.definitionChanges });
        void openFootnotePopup(opts.plugin, opts.footnoteId, () => {
            moveCursorAndSetJumpPoint(
                opts.doc,
                opts.origin,
                opts.definitionCursor,
                opts.plugin,
                undefined,
                true,
            );
        });
        // Stryker restore all
    } else {
        moveCursorAndSetJumpPoint(
            opts.doc,
            opts.origin,
            opts.definitionCursor,
            opts.plugin,
            opts.definitionChanges,
            true,
        );
    }
}

/**
 * The result gate's verdict on the definition a press in a table cell
 * appends for `footnoteId`, holding `body` when a conversion moves text
 * into it (`lines` lines of it). It is judged on the note before the cell
 * writes its reference, since the definition is planned the same way after
 * that write, only against the row's new text.
 */
export function definitionAppendVerdict(plugin: FootnotePlugin, doc: Editor, footnoteId: string, lines: number, body?: string): GateVerdict {
    const before = docLines(doc);
    const plan = planDefinitionAppend({ lines: before, edits: [], footnoteId, plugin, ...(body !== undefined ? { body } : {}) });
    return judgeEdit(before, plan.final, { created: [{ kind: "footnote", name: footnoteId, references: [], definition: { line: plan.labelLine, lines } }], insertedText: plan.heading });
}

/** Step 4 of the cascade, for the numbered key: insert the next-numbered reference at the caret, through `cell` when you are in a table, append its definition, and then open the popup or jump, whichever the settings say. */
export function createAutonumFootnote(
    lineText: string,
    cursorPosition: EditorPosition,
    plugin: FootnotePlugin,
    doc: Editor,
    cell: TableCellEditor | null = null,
    ctx: DocContext = docContext(doc),
): boolean {
    // Creating a footnote inside protected text is refused outright: code,
    // math, a comment, or the frontmatter.
    if (warnProtectedCaretIfInside(doc, cell, cursorPosition, ctx)) return true;
    // The same goes for a caret inside another footnote's definition. In
    // practice that means a continuation line, since a press on the label
    // line was already taken by the jump steps earlier in the cascade.
    if (warnDefinitionCaretIfInside(doc, cell, cursorPosition, ctx)) return true;
    // And for a caret on a table row but outside its cells, or on the row
    // of dashes under the header, where a reference would break the table.
    if (warnTableEdgeCaretIfOutside(cell, cursorPosition, ctx)) return true;

    // Make the footnote's name from the next free number, carrying the
    // note's footnote-prefix property when it has one (#31). A prefix is a
    // per-note namespace, so chapters merged into one document do not
    // collide. This reads the editor's own document, not the view's copy
    // of it, because that copy lags an edit by a tick and cannot be
    // trusted here. The prefix is read from the frontmatter alone: joining
    // ctx.lines built the whole document on every creation press just to
    // read its first few lines (a performance item from the 2026-08-11
    // review).
    //
    // An invalid prefix stops the insertion here and now, and the notice
    // has already explained why. Nothing unprefixed is created as a
    // fallback, so there is nothing to clean up. The press still counts as
    // handled.
    const footnoteId = autonumFootnoteId(plugin, doc, ctx);
    if (footnoteId === null) return true;
    const footnoteReference = referenceText(footnoteId);

    if (cell) {
        // The definition goes outside the table, through the main editor,
        // and the gate judges it before anything is written: once the
        // reference is in the cell, refusing its definition would leave the
        // reference with none.
        if (refusedCreation(definitionAppendVerdict(plugin, doc, footnoteId, 1))) return true;
        // The reference is written through the cell's own editor, never
        // the main editor, because a main-editor write races the cell's
        // write-back and corrupts the table. The definition is appended
        // outside the table, so writing that through the main editor is
        // safe. If the gate refuses the cell insertion, no orphaned
        // definition may be left behind.
        if (
            !insertInTableCell(cell, plugin, footnoteReference, footnoteReference.length, ctx.reading().linkLabels)
        ) {
            return true;
        }
        // The cell editor has written the reference back into the row by
        // now, and when that row is the note's LAST line the append point
        // moved with it. The context built before the press still holds
        // the old row, so the append was landing four characters short of
        // the row's new end - inside the reference - and the table widget
        // then normalised the mess away (Jason's report, sheet 05,
        // 2026-09-09: "only [^ is inserted and the last pipe disappears").
        // So the note is read again here. The blank line that keeps a
        // "---" first line from reading as frontmatter travels in the same
        // edit (see buildDefinitionAppend); it is inserted above the
        // table, outside the cell's own editor, so it is safe under the
        // issue #28 rule.
        const plan = planDefinitionAppend({ lines: docLines(doc), edits: [], footnoteId, plugin });
        landCellDefinitionAppend({
            plugin,
            doc,
            definitionChanges: plan.changes,
            origin: cursorPosition,
            footnoteId,
            definitionCursor: plan.cursor,
        });
        return true;
    }

    cursorPosition = adjustFootnotePosition(cursorPosition, ctx.reading(), lineText, plugin, ctx.lines);
    // The definition is planned against the note as it reads with the
    // reference already in (see planDefinitionAppend), and the two go out
    // as one transaction.
    const plan = planDefinitionAppend({
        lines: ctx.lines,
        edits: [{ from: cursorPosition, text: footnoteReference }],
        footnoteId,
        plugin,
    });

    // The insertion itself can change how Obsidian reads the note. Real
    // cases, found by the command-press property suite on 2026-08-12 and
    // the bug hunt of 2026-10-02. Putting "[^N]" at character 0 of a
    // quoted line pushes the quote marker over, so the line is no longer
    // quoted, and if that line opened a region, the region now swallows
    // everything below it, including the definition this very edit is
    // appending. A reference dropped between two stray dollar signs can
    // close them into inline math, which then swallows the reference. And
    // a reference that fills the empty line under a definition becomes
    // that definition's text, a nested footnote.
    //
    // The result gate judges the note exactly as the transaction leaves
    // it, and anything that came out wrong refuses the press with the
    // notice that says why.
    const verdict = judgeEdit(
        ctx.lines,
        plan.final,
        { created: [{ kind: "footnote", name: footnoteId, references: [plan.edits[0].start], definition: { line: plan.labelLine, lines: 1 } }], insertedText: plan.heading },
        ctx.reading(),
    );
    if (refusedCreation(verdict)) return true;

    landDefinitionBackedInsertion({
        plugin,
        doc,
        changes: plan.changes,
        origin: cursorPosition,
        footnoteId,
        definitionCursor: plan.cursor,
        afterReference: plan.edits[0].end,
    });
    return true;
}

/** Step 3 of the cascade, reached by the numbered, named, and inline keys through navigateReferenceIfInside. The caret is on a reference that has no definition, so append the matching definition, or warn when the name cannot work. Returns true when it handled the press. The note's footnote-prefix is not added here: it goes on when the brackets are first created, in createFootnoteReference, where you can see it. */
export function createMatchingFootnoteDefinition(
    lineText: string,
    cursorPosition: EditorPosition,
    plugin: FootnotePlugin,
    doc: Editor,
    ctx?: DocContext,
): boolean {
    // Create the matching definition for a footnote reference.

    // The three questions, in order:
    //   is the caret inside a footnote reference on this line?
    //   does that reference already have a definition?
    //   if not, create one and put the caret in it.
    //
    // The shared lookup checks the raw line first and only then the masked
    // twin: cheap test first (performance item F1), then the masked
    // re-check that issue #41 needs, then the name re-sliced from the raw
    // line. That last step matters because building a definition from the
    // masked name once wrote literal NUL bytes into the note
    // (bug-masked-name-identity). See referenceOccurrenceAtCursor.
    const hit = referenceOccurrenceAtCursor(lineText, cursorPosition, doc, ctx);
    if (hit === null) {
        return false;
    }
    ctx = hit.ctx;
    const footnoteId = hit.target.name;

    // A name with a space or a backtick in it is a typing mistake that
    // Obsidian will not render at all, and a name with a "#" in it is one
    // Obsidian's preview and sidebar cannot find (see footnoteNameProblem).
    // Show one warning that names the culprit, rather than building a
    // definition that could never work.
    if (footnoteNameProblem(footnoteId) !== null) {
        showNotice(
            `${quotedReference(footnoteId)} won't work as a footnote. ${InvalidNameCharacters}`,
            8000,
        );
        return true;
    }
    // A reference sitting inside another footnote's definition (on a
    // continuation line, lazy or indented) would get a definition of its
    // own here, and that completes a nested footnote, which the plugin
    // refuses to create everywhere (ADR 1). The same guard the creation
    // steps run. Found by the named-flow property once a plain line under
    // a definition counted as its continuation (GLM hunt cycle 1,
    // 2026-09-16).
    if (warnDefinitionCaretIfInside(doc, null, cursorPosition, ctx)) return true;

    const list = listExistingFootnoteDefinitions(doc, ctx);

    // Footnote names ignore case, so a "[^note]:" definition already
    // serves a "[^Note]" reference. The press has to jump to that
    // definition rather than create a duplicate one.
    if (!idListIncludes(list, footnoteId)) {
        const plan = planDefinitionAppend({ lines: ctx.lines, edits: [], footnoteId, plugin });
        // The new definition must be live where it lands, as every other
        // creation's: at the end of a note whose last line is a "$$" after
        // a paragraph, a definition appended below it is taken into the
        // math block that line then opens (rule M2), so the press refuses
        // instead of writing a definition Obsidian never shows (the runtime
        // swap, 2026-10-03; found by the multi-caret named-flow property).
        const verdict = judgeEdit(
            ctx.lines,
            plan.final,
            { created: [{ kind: "footnote", name: footnoteId, references: [], definition: { line: plan.labelLine, lines: 1 } }], insertedText: plan.heading },
            ctx.reading(),
        );
        if (refusedCreation(verdict)) return true;
        landDefinitionBackedInsertion({
            plugin,
            doc,
            changes: plan.changes,
            origin: cursorPosition,
            footnoteId,
            definitionCursor: plan.cursor,
            // No afterReference here. This press adds a definition for a
            // reference the caret is already inside, so there is no newly
            // inserted reference to park the caret behind.
        });
        return true;
    }
    // The reference already has a definition, so this step has nothing to
    // do with the press. Hand it on to the next step of the cascade.
    return false;
}

/** Step 4 of the cascade, for the named key: insert an empty reference ready for you to type a name into, through `cell` when you are in a table. That is "[^]" with the caret between the brackets, or "[^7-]" with the caret after the prefix when the note has a footnote-prefix, so you can see the namespace while you type (requested 2026-07-20). A press made while the caret is still inside an empty "[^]" never gets this far, because warnEmptyReferenceIfInside claims it as the command starts. The branches below that hop the caret out stay anyway, as a last defense against nesting one placeholder inside another as "[^[^]]". */
export function createFootnoteReference(
    lineText: string,
    cursorPosition: EditorPosition,
    plugin: FootnotePlugin,
    doc: Editor,
    cell: TableCellEditor | null = null,
    ctx: DocContext = docContext(doc),
): boolean {
    //Create an empty reference for you to name, with the caret after "[^"
    //and after any prefix. Order matters: the prefix check runs AFTER the
    //checks that hop the caret out on a second press. An invalid prefix
    //stops a reference being CREATED, showing a message and leaving
    //nothing to clean up (reported 2026-08-07), but it must never stop
    //plain caret navigation.
    // footnotePrefixFromEditor stops reading at the closing frontmatter
    // fence. The old doc.getValue() built the whole document on every
    // press (the half of performance item F1 this path had missed).
    const resolvePrefix = () =>
        plugin.settings.enableFootnotePrefix
            ? activeFootnotePrefix(plugin, footnotePrefixFromEditor(doc))
            : "";

    if (cell) {
        const cellText = cell.state.doc.toString();
        // Confirm against the masked twin, as caretInsidePlaceholder does.
        // Something shaped like "[^]" inside inline code is just plain
        // text, not a placeholder (the rule issue #41 settled).
        const inEmpty = emptyReferenceStart(cellText, cellCaret(cell));
        if (
            inEmpty !== null &&
            emptyReferenceStart(
                maskInlineRegions(cellText),
                cellCaret(cell),
            ) !== null
        ) {
            cell.dispatch({ selection: { anchor: inEmpty + "[^]".length } });
            return true;
        }
        // Creating a footnote inside a cell's inline code or math span is
        // refused.
        if (warnProtectedCaretIfInside(doc, cell, cursorPosition, ctx)) {
            return true;
        }
        const prefix = resolvePrefix();
        if (prefix === null) return true;
        // Written through the cell's own editor, never the main editor,
        // because a main-editor write races the cell's write-back and
        // corrupts the table. The caret lands inside the brackets and
        // focus stays in the cell, ready for you to type the name.
        insertInTableCell(cell, plugin, referenceText(prefix), 2 + prefix.length, ctx.reading().linkLabels);
        return true;
    }

    // A "]" typed as the placeholder's name closes it early: the line reads
    // "[^]" then the typed "]", with the caret between them. That is a
    // name that can't be, not an empty placeholder to hop out of, and
    // every other guard looks past it, so a second press used to plant a
    // second "[^]" right there (Kimi sweep 2026-09-13). Say what is wrong
    // with the name instead, and leave the line alone. The shape is looked
    // for on the masked twin, as the hop below does: "[^]]" inside inline
    // code is plain text, no name at all, and a press there gets the
    // protected-text notice like any other press in code (hunt 2026-10-02,
    // pin bug-press-named-inline-code-wrong-toast).
    const maskedText = ctx.maskedLine(cursorPosition.line);
    if (
        maskedText.slice(0, cursorPosition.ch).endsWith("[^]") &&
        maskedText[cursorPosition.ch] === "]"
    ) {
        showNotice(InvalidNameCharacters, 8000);
        return true;
    }

    // Mask with the whole document in view, exactly as the
    // warnEmptyReferenceIfInside guard does. Masking one line on its own
    // cannot see a code fence that surrounds it, so the guard and this hop
    // disagreed about such a line and the caret hopped into protected text
    // (2026-08-11 review, bug #6).
    const inEmpty = emptyReferenceStart(lineText, cursorPosition.ch);
    if (
        inEmpty !== null &&
        emptyReferenceStart(
            ctx.maskedLine(cursorPosition.line),
            cursorPosition.ch,
        ) !== null
    ) {
        doc.setCursor({ line: cursorPosition.line, ch: inEmpty + "[^]".length });
        return true;
    }

    // Creating a footnote inside protected text is refused outright: code,
    // math, a comment, or the frontmatter. This must come AFTER the hop
    // check above, or hopping the caret out of a live "[^]" would show a
    // refusal message it does not deserve.
    if (warnProtectedCaretIfInside(doc, null, cursorPosition, ctx)) return true;
    // The same goes for a caret inside another footnote's definition
    // (Jason's ruling 2026-08-13).
    if (warnDefinitionCaretIfInside(doc, null, cursorPosition, ctx)) return true;
    // And for a caret on a table row but outside its cells, or on the row
    // of dashes under the header, where a placeholder would break the table.
    if (warnTableEdgeCaretIfOutside(null, cursorPosition, ctx)) return true;

    const prefix = resolvePrefix();
    if (prefix === null) return true;
    const emptyReference = referenceText(prefix);
    cursorPosition = adjustFootnotePosition(cursorPosition, ctx.reading(), lineText, plugin, ctx.lines);
    // The result gate judges the placeholder as the name typed into it
    // would read. If it landed inside protected text, it would not be a
    // real footnote, and you would be left typing a name into something
    // that can never become one, with nothing to tell you so. Nor may it
    // land inside a definition, where the footnote you name would be
    // nested.
    const after = simulateChanges(ctx.lines, [{ from: cursorPosition, text: emptyReference }]);
    const verdict = judgeEdit(ctx.lines, after, { created: [{ kind: "placeholder", text: emptyReference, at: [cursorPosition] }] }, ctx.reading());
    if (refusedCreation(verdict)) return true;
    const newCursorPos = {
        line: cursorPosition.line,
        ch: cursorPosition.ch + 2 + prefix.length,
    };
    moveCursorAndSetJumpPoint(doc, cursorPosition, newCursorPos, plugin, [
        { from: cursorPosition, text: emptyReference },
    ]);
    return true;
}
