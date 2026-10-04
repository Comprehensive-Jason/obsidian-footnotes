import { Editor, EditorPosition, MarkdownView } from "obsidian";

import type FootnotePlugin from "../main";

import { DocContext, docLines, insideDefinition } from "../editor/doc-context";
import { deadInsertionVerdict, InsertionVerdict } from "../editor/insertion-liveness";
import { inlineNoteInCell, maskInlineRegions } from "../parsing/cell-reading";
import { NoteReading, readNote } from "../parsing/note-reading";
import { cellCaret, TableCellEditor } from "../editor/table-cursor";

import { showNotice } from "../editor/notice";
import { readingViewActive } from "../editor/obsidian-internals";
// Inline footnotes, the self-contained "^[...]" form. This file holds
// sanitizing pasted content so it is safe as a body and the two caret
// guards every command shares; where an inline footnote starts and ends is
// the note reading's to say (NoteReading.inlineNoteAt). Split out of the
// all-in-one commands file 2026-08-11.

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
 * When "^[text]" already reads as one whole inline footnote, the text is
 * left as it is: brackets that balance, so a pasted markdown link still
 * works, and a lone bracket inside a code span, which Obsidian does not
 * count (a backslash there would show, since code keeps backslashes; hunt
 * 2026-10-02, pin bug-convert-code-span-bracket-escaped). Otherwise a
 * bracket or a backtick would end the "^[...]" early, or keep it from
 * closing, and corrupt the note, so every bare bracket and backtick
 * outside a code span is escaped instead: the inline footnote's reader
 * skips over a code span whole and counts every other bracket, and a
 * backtick with no partner opens a code span it never closes (so
 * "see [note and `a]`" became "x^[see [note and `a]`]", no footnote at
 * all to Obsidian; hunt 2026-10-02, pin
 * bug-convert-unbalanced-bracket-beside-code, found again when its test
 * asked the note reading, the runtime swap step 4, 2026-10-03). Characters
 * that were already escaped keep the meaning they had.
 *
 * A trailing backslash left dangling would escape the wrapper's own closing
 * "]", so it is doubled into a literal backslash. Input that is empty, or
 * only whitespace, comes back as "".
 */
export function sanitizeInlineFootnoteContent(raw: string): string {
    let text = raw.replace(/\s+/g, " ").trim();
    // an odd number of backslashes at the end leaves one of them escaping
    // the wrapper's own closing "]". Double it, so it renders as a plain
    // backslash instead.
    const trailing = /\\*$/.exec(text);
    if (trailing && trailing[0].length % 2 === 1) {
        text += "\\";
    }
    if (wrapReadsWhole(text)) return text;
    // the code spans of the text, as the note reading finds them
    const code = readNote([text]).protectedSpans.filter((span) => span.kind === "inlineCode");
    const inCode = (at: number) => code.some((span) => span.from <= at && at < span.to);
    // an escaped character (a backslash and what follows) is left as it is
    return text.replace(/\\[\s\S]|[[\]`]/g, (m: string, at: number) => (m.length === 2 || inCode(at) ? m : `\\${m}`));
}

/** Whether "^[text]" on a line of its own reads as one inline footnote from its "^" to its last "]", as the note reading finds it. */
function wrapReadsWhole(text: string): boolean {
    const wrap = `^[${text}]`;
    const note = readNote([wrap]).inlineNoteAt(0, 1);
    return note !== null && note.open === 0 && note.close === wrap.length - 1;
}

/**
 * The born-dead rule, kept in one place (duplicated-logic audit,
 * 2026-09-05). "Born-dead" means an insertion that would not be a live
 * footnote the moment it lands.
 *
 * The question this answers: with `text` written at column `at` of line
 * `line`, does it still read as what it is in `after`, the reading of the
 * note as the edit leaves it? An inline footnote has to read as one whole
 * inline footnote, because pasted content can carry code of its own INSIDE
 * the brackets. Anything else, the empty "[^]" placeholder, has to come
 * back byte for byte on the masked twin, and must not open inside a link:
 * "[sic][^]" is a reference link to Obsidian, so the name typed into it
 * would never make a footnote (Jason's ruling, 2026-10-04).
 *
 * The answer: "live" when it reads as itself; "link" when it does not and
 * a link took it in (deadInsertionVerdict); "dead" when it completed some
 * other markdown construct around itself and would be born inside
 * protected text.
 */
export function landingVerdict(after: NoteReading, line: number, at: number, text: string): "live" | "dead" | "link" {
    const intact = text.startsWith("^[")
        ? inlineWrapLandsIntact(after, line, at, text.length)
        : after.maskedLine(line).slice(at, at + text.length) === text && !after.insideLink(line, at);
    return intact ? "live" : deadInsertionVerdict(after, { line, ch: at });
}

/**
 * The verdict for `text` written with no definition alongside it (an
 * inline footnote, the empty "[^]" placeholder) at every one of `anchors`,
 * judged on `after`, the note as the edit leaves it. The first one that
 * would not read as itself decides: "link" when a link took it in, "dead"
 * otherwise (landingVerdict). "nested" when one lands on a line that
 * belongs to a definition, which is what filling the empty line right
 * under a definition does (ADR 0001; hunt 2026-10-02, pin
 * bug-press-blank-line-under-definition-nests), otherwise "live". The same
 * answers verifyLiveFootnoteInsertion gives a reference that comes with
 * its definition.
 */
export function bareInsertionVerdict(after: DocContext, anchors: EditorPosition[], text: string): InsertionVerdict {
    for (const at of anchors) {
        const landed = landingVerdict(after.reading(), at.line, at.ch, text);
        if (landed !== "live") return landed;
    }
    return anchors.some((at) => insideDefinition(after, at.line)) ? "nested" : "live";
}

/**
 * Whether a just-inserted inline-footnote wrapper at column `at` of line
 * `line` reads INTACT in `after`, the reading of the note as the edit
 * leaves it: an inline footnote that opens exactly at the wrapper's "^" AND
 * closes on the wrapper's own "]".
 *
 * That second half matters. Checking only the opening accepted a wrap whose
 * closing bracket a newly formed "$…$" pair had swallowed, and the rendered
 * line was math eating the prose around it (hunt 2026-08-25,
 * bug-inline-wrap-close-swallowed).
 *
 * This is the ONE test every writer of an inline wrap uses: insertion at
 * the caret, paste, multi-caret skeletons, writes into a table cell, and
 * converting a selection.
 */
export function inlineWrapLandsIntact(after: NoteReading, line: number, at: number, wrapLength: number): boolean {
    const note = after.inlineNoteAt(line, at + 1);
    return note !== null && note.open === at && note.close === at + wrapLength - 1;
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
 * The inline footnote at the caret, as the note reading finds it, with the
 * masked line it sits on.
 *
 * A "^[…]"-shaped fragment inside a code fence, inline code, or a comment
 * is plain text, not an inline footnote. Treating it as one made every
 * command do nothing there except show a misleading toast (2026-08-11
 * review bug #7). And a bracket inside a code span neither opens nor
 * closes one, while counting brackets on the raw line said it did, so a
 * press inside "^[press the `[` key]" nested a reference into it (hunt
 * 2026-10-02, cluster G1): the reading, which matches the brackets the
 * way Obsidian does, decides.
 *
 * A line with no "^[" at all is settled first, to keep the reading out of
 * the path most presses take.
 */
function maskedInlineFootnoteSpan(
    doc: Editor,
    cell: TableCellEditor | null,
    cursorPosition?: EditorPosition,
): { text: string; open: number; close: number } | null {
    if (cell) {
        const raw = cell.state.doc.toString();
        if (!raw.includes("^[")) return null;
        // a cell's text is read as the one cell of a one-row table
        const span = inlineNoteInCell(raw, cellCaret(cell));
        return span === null ? null : { text: maskInlineRegions(raw), ...span };
    }
    const pos = cursorPosition ?? doc.getCursor();
    if (!doc.getLine(pos.line).includes("^[")) return null;
    const reading = readNote(docLines(doc));
    const span = reading.inlineNoteAt(pos.line, pos.ch);
    return span === null ? null : { text: reading.maskedLine(pos.line), ...span };
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
