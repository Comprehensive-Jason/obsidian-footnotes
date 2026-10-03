import { Editor, EditorPosition, MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";

import { DocContext, docLines, insideDefinition } from "../editor/doc-context";
import { InsertionVerdict } from "../editor/insertion-liveness";
import { maskInlineRegions, maskedLineAt } from "../parsing/markdown-scan";
import { cellCaret, TableCellEditor } from "../editor/table-cursor";

import { showNotice } from "../editor/notice";
import { readingViewActive } from "../editor/obsidian-internals";
// Inline footnotes, the self-contained "^[...]" form. This file holds
// sanitizing pasted content so it is safe as a body and the two caret
// guards every command shares (the span scanner moved down to the grammar
// on 2026-09-21). Split out of the all-in-one commands file 2026-08-11.

/**
 * The last stretch of both paste commands, shared by the single-caret and
 * the multi-caret paste. It used to be copied between the two, and this is
 * the one duplicate where the copies drifting apart would be dangerous.
 *
 * It does three things in order. Read the clipboard, which is the only
 * await in either command. Then check the view mode again, because the user
 * (or a script) can switch to Reading view while the clipboard permission
 * prompt is up, and the editor API would then edit the hidden buffer behind
 * it (2026-08-11 review). Then refuse an empty body.
 *
 * Returns the finished "^[…]" text, or null when the press is already
 * settled: the failure or the emptiness has been toasted, or the view can
 * no longer be edited. Callers must run every guard BEFORE calling this, so
 * that a press which will be refused never touches the clipboard at all.
 */
export async function readInlineFootnoteFromClipboard(
    plugin: FootnotePlugin,
): Promise<string | null> {
    let raw: string;
    try {
        raw = await navigator.clipboard.readText();
    } catch {
        showNotice("Couldn't read the clipboard.");
        return null;
    }
    const viewAfterAwait = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!viewAfterAwait || readingViewActive(viewAfterAwait)) return null;
    const content = sanitizeInlineFootnoteContent(raw);
    if (!content) {
        showNotice("The clipboard is empty, so there is nothing to put in an inline footnote.");
        return null;
    }
    return `^[${content}]`;
}

/**
 * Clipboard text made safe to use as the body of an inline footnote.
 *
 * An inline footnote lives on one line, so any run of whitespace, newlines
 * included, becomes a single space, and the result is trimmed.
 *
 * Brackets that balance are left alone, so a pasted markdown link still
 * works. If any bracket does not balance, it would end the "^[...]" early
 * and corrupt the note, so every bare bracket is escaped instead. Brackets
 * that were already escaped as \[ and \] keep the meaning they had.
 *
 * A trailing backslash left dangling would escape the wrapper's own closing
 * "]", so it is doubled into a literal backslash. Input that is empty, or
 * only whitespace, comes back as "".
 */
export function sanitizeInlineFootnoteContent(raw: string): string {
    let text = raw.replace(/\s+/g, " ").trim();
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\\") {
            i++; // an escaped character cannot open or close anything
        } else if (c === "[") {
            depth++;
        } else if (c === "]") {
            depth--;
            if (depth < 0) break;
        }
    }
    if (depth !== 0) {
        // leave \[ and \] exactly as the balance scan above read them, and
        // escape only the bare brackets
        text = text.replace(/\\[\s\S]|[[\]]/g, (m) =>
            m.length === 2 ? m : `\\${m}`,
        );
    }
    // an odd number of backslashes at the end leaves one of them escaping
    // the wrapper's own closing "]". Double it, so it renders as a plain
    // backslash instead.
    const trailing = /\\*$/.exec(text);
    if (trailing && trailing[0].length % 2 === 1) {
        text += "\\";
    }
    return text;
}

/**
 * The born-dead rule, kept in one place (duplicated-logic audit,
 * 2026-09-05). "Born-dead" means an insertion that would not be a live
 * footnote the moment it lands.
 *
 * The question this answers: with `text` written at `at`, does it still
 * read as what it is on the MASKED simulated line? An inline footnote has
 * to survive as one whole span, because pasted content can carry code of
 * its own that gets masked INSIDE the brackets. Anything else, a reference
 * or a placeholder, has to come back byte for byte. If it does not, the
 * insertion completed some markdown construct around itself and would be
 * born inside protected text.
 */
export function insertionLandsIntact(masked: string, at: number, text: string): boolean {
    return text.startsWith("^[")
        ? inlineWrapLandsIntact(masked, at, text.length)
        : masked.slice(at, at + text.length) === text;
}

/**
 * The verdict for `text` written with no definition alongside it (an
 * inline footnote, the empty "[^]" placeholder) at every one of `anchors`,
 * judged on `after`, the note as the edit leaves it. "dead" when one of
 * them would not read as itself (insertionLandsIntact), "nested" when one
 * lands on a line that belongs to a definition, which is what filling the
 * empty line right under a definition does (ADR 0001; hunt 2026-10-02,
 * pin bug-press-blank-line-under-definition-nests), otherwise "live". The
 * same three answers verifyLiveFootnoteInsertion gives a reference that
 * comes with its definition.
 */
export function bareInsertionVerdict(after: DocContext, anchors: EditorPosition[], text: string): InsertionVerdict {
    if (!anchors.every((at) => insertionLandsIntact(after.maskedLine(at.line), at.ch, text))) return "dead";
    return anchors.some((at) => insideDefinition(after, at.line)) ? "nested" : "live";
}

/**
 * Whether a just-inserted inline-footnote wrapper at `at` survives INTACT
 * on the masked simulated line. The span must open exactly at the wrapper's
 * "^" AND close on the wrapper's own "]".
 *
 * That second half matters. Checking only the opening accepted a wrap whose
 * closing bracket a newly formed "$…$" pair had swallowed. The bracket walk
 * then latched onto some unrelated later "]", and the rendered line was
 * math eating the prose around it (hunt 2026-08-25,
 * bug-inline-wrap-close-swallowed).
 *
 * This is the ONE test every writer of an inline wrap uses: insertion at
 * the caret, paste, multi-caret skeletons, writes into a table cell, and
 * converting a selection.
 */
export function inlineWrapLandsIntact(
    masked: string,
    at: number,
    wrapLength: number,
): boolean {
    const span = inlineFootnoteSpanAt(masked, at + 2);
    return (
        span !== null && span.open === at && span.close === at + wrapLength - 1
    );
}

// The span scanner (inlineFootnoteSpanAt, and the inlineFootnoteSpans
// enumerator the punctuation rule uses) lives in parsing/footnote-grammar
// since 2026-09-21, so the linting layer can read inline spans without
// importing this editor-facing module. It is re-exported here for the
// callers that always found it here.
import { inlineFootnoteSpanAt } from "../parsing/footnote-grammar";
export { inlineFootnoteSpanAt };

/** The position just past an inline footnote's closing bracket, when `ch` sits inside one. Null when it does not. */
export function inlineFootnoteExitCh(lineText: string, ch: number): number | null {
    const span = inlineFootnoteSpanAt(lineText, ch);
    return span === null ? null : span.close + 1;
}

/**
 * When the caret sits inside an EMPTY inline footnote, meaning "^[]" or
 * only whitespace between the brackets, leave the caret where it is, ask
 * for the text with a Notice, and report true. Every footnote command
 * shares this, exactly as they share the empty "[^]" reference guard
 * (manual combo-test feedback, 2026-08-08). Before it existed, a second
 * press silently hopped the caret out and left an inline footnote with
 * nothing in it.
 *
 * A FILLED inline footnote is none of this guard's business. There the
 * press falls through to exitInlineFootnoteIfInside, which is the
 * deliberate "done typing" hop.
 */
export function warnEmptyInlineFootnoteIfInside(
    doc: Editor,
    cell: TableCellEditor | null,
    // the table sub-editor fallback works out the real caret before the
    // command runs. Guards must use that position rather than reading
    // getCursor() again, which may be stale (2026-08-11 review bug #9).
    cursorPosition?: EditorPosition,
): boolean {
    const span = maskedInlineFootnoteSpan(doc, cell, cursorPosition);
    if (span === null) return false;
    if (span.text.slice(span.open + 2, span.close).trim() !== "") return false;
    showNotice(
        "This inline footnote is empty. Type its text between the brackets.",
        8000,
    );
    return true;
}

/**
 * The inline-footnote span at the caret, worked out against MASKED text.
 *
 * A "^[…]"-shaped fragment inside a code fence, inline code, or a comment
 * is plain text, not an inline footnote. Treating it as one made every
 * command do nothing there except show a misleading toast (2026-08-11
 * review bug #7).
 *
 * A cheap scan of the raw line comes first, to keep the whole-document
 * masking out of the path every press takes. Masking preserves positions,
 * so the span it reports is still valid against the raw line.
 */
function maskedInlineFootnoteSpan(
    doc: Editor,
    cell: TableCellEditor | null,
    cursorPosition?: EditorPosition,
): { text: string; open: number; close: number } | null {
    if (cell) {
        const raw = cell.state.doc.toString();
        const ch = cellCaret(cell);
        if (inlineFootnoteSpanAt(raw, ch) === null) return null;
        // a cell's text is a single line, so masking that one line is enough
        const masked = maskInlineRegions(raw);
        const span = inlineFootnoteSpanAt(masked, ch);
        return span === null ? null : { text: masked, ...span };
    }
    const pos = cursorPosition ?? doc.getCursor();
    const raw = doc.getLine(pos.line);
    if (inlineFootnoteSpanAt(raw, pos.ch) === null) return null;
    const masked = maskedLineAt(docLines(doc), pos.line);
    const span = inlineFootnoteSpanAt(masked, pos.ch);
    return span === null ? null : { text: masked, ...span };
}

/**
 * When the caret sits inside an inline footnote ("^[...]"), hop it just
 * past the closing bracket and report true. Every insert command shares
 * this. For the numbered and named commands it stops a "[^x]" reference
 * being nested inside the inline footnote's brackets, which would end the
 * inline footnote early and corrupt it ("^[in [^named]line]").
 */
export function exitInlineFootnoteIfInside(
    doc: Editor,
    cell: TableCellEditor | null,
    cursorPosition?: EditorPosition,
): boolean {
    const span = maskedInlineFootnoteSpan(doc, cell, cursorPosition);
    if (span === null) return false;
    const exit = span.close + 1;
    if (cell) {
        cell.dispatch({ selection: { anchor: exit } });
        return true;
    }
    const pos = cursorPosition ?? doc.getCursor();
    doc.setCursor({ line: pos.line, ch: exit });
    return true;
}
