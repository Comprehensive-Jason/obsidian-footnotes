import { Editor, EditorChange, EditorPosition } from "obsidian";

import type FootnotePlugin from "../main";
import { docLines } from "./doc-context";
import { mapPosition, safeInsertionCh } from "./insertion-liveness";
import { FootnotePlacement, imageStartsOn, lineLinkLikeEndAt, linkLikeEndAt, punctuationAt, referenceLandingAfter } from "../parsing/landing";
import { NoteReading, readNote } from "../parsing/note-reading";
import {
    EditorWithCm,
    VaultWithConfig,
    WindowWithVim,
} from "./obsidian-internals";
import { nestedSubEditorOwnsFocus } from "./table-cursor";

// Caret placement. Two things live here: the single function that moves the
// cursor (it records a vim jump point, and it sends any text changes out in
// the same transaction), and the end-of-word adjustment that works out
// where an insertion really goes. Split out of the all-in-one commands file
// 2026-08-11.

export function moveCursorAndSetJumpPoint(
    doc: Editor,
    oldCursorPos: EditorPosition,
    newCursorPos: EditorPosition,
    plugin: FootnotePlugin,
    changes?: EditorChange[],
    center = false,
): void {
    // when focus sits in a smaller editor nested inside the main one (a
    // table cell being edited), hand it back to the main editor BEFORE
    // moving the cursor. Otherwise a jump out of the table leaves your
    // keystrokes going to the cell editor you just left. A jump INTO a
    // table needs no such care: cell editing switches itself on
    const cmView = (doc as EditorWithCm).cm;
    if (cmView && nestedSubEditorOwnsFocus(doc)) {
        cmView.focus();
    }

    // getConfig is undocumented API, like the vim internals below
    const vim = Boolean((plugin.app.vault as VaultWithConfig).getConfig?.("vimMode"));
    // Vim places its jump point in the note as it is after the changes, so
    // the old caret goes through them first: a definition added above it
    // moves it down a line, and Ctrl-O came back one line too high (hunt
    // 2026-10-02, pin bug-press-vim-jump-point-stale). Text written right at
    // the old caret goes after it, so Ctrl-O comes back to where the press
    // was, in front of the new reference.
    const jumpFrom =
        vim && changes && changes.length > 0 ? mapPosition(docLines(doc), changes, oldCursorPos, -1) : oldCursorPos;

    if (changes && changes.length > 0) {
        // the text edits and the cursor move must go out as ONE
        // transaction. While a table cell is being edited (the table editor
        // in Obsidian 1.5+), sending them separately in the same tick races
        // the cell editor's write-back and corrupts the document (issue
        // #28). `selection` here counts against the document as it is AFTER
        // the changes.
        doc.transaction({ changes, selection: { from: newCursorPos } });
    } else {
        doc.setCursor(newCursorPos);
    }

    // a jump lands CENTERED on screen. Obsidian's own scrolling does the
    // least it can and parks the cursor at the very edge of the view, which
    // on mobile is nearly off screen. An insert near where you already are
    // passes center=false, so the page does not shift under you.
    if (center) {
        doc.scrollIntoView({ from: newCursorPos, to: newCursorPos }, true);
    }

    // if the user has vim mode on, add this move to vim's jump list
    if (vim) {
        (activeWindow as WindowWithVim).CodeMirrorAdapter?.Vim.getVimGlobalState_().jumpList.add(
            (doc as EditorWithCm).cm?.cm, // yes, ".cm.cm": vim wants the inner editor, two levels down
            jumpFrom,
            newCursorPos,
        );
    }
}

// What counts as a word character in the walks below: any unicode letter,
// number, or mark. Marks include combining accents, which belong to the
// word they follow, matching the grapheme-aware `wordAt`. The two
// invisible joiners count the same way: the zero-width non-joiner (U+200C)
// written inside Persian words and the zero-width joiner (U+200D) of
// Devanagari half forms never end a word, in Unicode's word rules or in
// the editor's `wordAt` (hunt 2026-10-02, pin
// bug-landing-word-walk-joiners: a press in a Persian word that holds one
// wrote the reference at the joiner, splitting the word). \p{Join_C} is
// exactly those two characters. The walks step by whole CODE POINTS: letters
// outside the basic range (Deseret, CJK Ext-B like 𠮷) take two UTF-16
// units, and testing one half of such a pair on its own against \p{L}
// split words apart inside table cells (bug-astral-word-walk).
const isWordCp = (cp: number | undefined) =>
    cp !== undefined && /[\p{L}\p{N}\p{M}\p{Join_C}_]/u.test(String.fromCodePoint(cp));

// The code point touching `i` from the left, or undefined when `i` is at
// the very start of the text. When that code point takes two UTF-16 units,
// this steps back to the start of the pair, and an `i` sitting in the
// middle of a pair counts as being inside that pair.
const cpBefore = (text: string, i: number): number | undefined => {
    if (i <= 0) return undefined;
    const prev = text.charCodeAt(i - 1);
    if (prev >= 0xd800 && prev <= 0xdbff) {
        return text.codePointAt(i - 1); // `i` sits mid-pair
    }
    if (prev >= 0xdc00 && prev <= 0xdfff && i >= 2) {
        return text.codePointAt(i - 2);
    }
    return prev;
};

/** Which of two positions comes first in the document. Negative, zero, or
 * positive, like any sort comparator. The one copy of it; it used to live
 * in two files. */
export function comparePositions(a: EditorPosition, b: EditorPosition): number {
    return a.line - b.line || a.ch - b.ch;
}

/**
 * The end-of-word adjustment worked out on one line's text: starting at
 * `offset`, the end of the word under the cursor (or just before it), plus
 * the closing marks and punctuation after it. An offset with no word
 * touching it comes back unchanged.
 *
 * `linkEnd` is where the link-like construct holding `offset` ends, or -1
 * when there is none (linkLikeEndAt). The main editor passes what the note
 * reading says and a table cell what its cell reading says; by default the
 * text is read on its own, as a note of one line. `images` are the columns
 * where the line draws an image or an embed, whose "!" is no punctuation
 * (punctuationAt), handed in the same way.
 */
export function endOfWordOffset(
    text: string,
    offset: number,
    placement: FootnotePlacement = "after",
    linkEnd: number = lineLinkLikeEndAt(text, offset),
    images?: ReadonlySet<number>,
): number {
    // Inside a link, a wikilink, an address, or an email address the
    // "word" is the whole construct: a reference written inside
    // "[text](url)" or between the segments of "example.com" breaks the
    // link (Jason's landing rulings, 2026-09-15).
    if (linkEnd !== -1) return referenceLandingAfter(text, linkEnd, placement, images);
    const end = wordEndOffset(text, offset);
    if (end === -1) return offset;
    // then past the closing marks, and past or in front of the punctuation
    // that follows the word as the placement setting says (the landing
    // convention, referenceLandingAfter)
    return referenceLandingAfter(text, end, placement, images);
}

/**
 * The end of the word `offset` sits in or just after, or -1 when it sits
 * on no word. An apostrophe (straight or curly) or a dot between two word
 * characters belongs to the word ("don't", "Marx's", "U.S.",
 * "example.com"), so the walk crosses it instead of stopping in front of
 * it (Jason's landing rulings, 2026-09-15).
 */
function wordEndOffset(text: string, offset: number): number {
    if (
        !isWordCp(text.codePointAt(offset)) &&
        !isWordCp(cpBefore(text, offset))
    ) {
        return -1;
    }
    let end = offset;
    // a start offset landing in the middle of a two-unit code point (found
    // by fast-check, 2026-08-10) snaps back to that code point's boundary,
    // so the walk, and the caret it returns, always land between code
    // points
    const unitAtEnd = text.charCodeAt(end);
    if (unitAtEnd >= 0xdc00 && unitAtEnd <= 0xdfff) end--;
    for (;;) {
        const cp = text.codePointAt(end);
        if (!isWordCp(cp)) {
            const c = text[end];
            if (
                (c === "'" || c === "\u2019" || c === ".") &&
                isWordCp(cpBefore(text, end)) &&
                isWordCp(text.codePointAt(end + 1))
            ) {
                end++;
                continue;
            }
            break;
        }
        end += (cp as number) > 0xffff ? 2 : 1;
    }
    return end;
}

/**
 * Where a SELECTION grows to at its end when it is expanded to whole words:
 * the end of the word, plus at most one trailing punctuation mark, and no
 * closing quote or emphasis marker. A selection is not an insertion: the
 * closing mark belongs to the text around the new footnote, not inside it
 * ("This is \"some bravo\". End" gives "some bravo" and leaves the quote;
 * Claude sweep 2026-09-13, the README's "plus one trailing punctuation
 * mark"). `images` are the columns where the line draws an image or an
 * embed, as endOfWordOffset takes them.
 */
export function endOfWordForSelection(text: string, offset: number, placement: FootnotePlacement = "after", images?: ReadonlySet<number>): number {
    const end = wordEndOffset(text, offset);
    if (end === -1) return offset;
    // the trailing mark comes along only when the reference is to land
    // after it: under "before" or "don't move" the reference goes in front
    // of the mark, so the mark stays outside the selection (T5, 2026-09-21)
    if (placement !== "after") return end;
    return punctuationAt(text, end, images) ? end + 1 : end;
}

/**
 * endOfWordOffset's twin at the other end of a word, used when a selection
 * is expanded to whole words before it is turned into a footnote (Jason's
 * ask 2026-08-29): starting at `offset`, the start of the word the offset
 * sits strictly INSIDE.
 *
 * An offset already at a word's first character, or not on a word
 * character at all, comes back unchanged. There is no punctuation grab at
 * this end, because the insertion hop has nothing like it at this end
 * either.
 */
export function startOfWordOffset(text: string, offset: number): number {
    let start = offset;
    // an offset in the middle of a two-unit code point snaps back to that
    // code point's start before the checks below run
    const unitAt = text.charCodeAt(start);
    if (unitAt >= 0xdc00 && unitAt <= 0xdfff) start--;
    // A selection that starts AT a word's trailing dot ("U.S.| Senate",
    // dragged from just before the dot) grows back over the word, so the
    // footnote reads "U.S. Senate" rather than ". Senate" (Jason's ruling
    // 3, 2026-09-20): the dot is the word's last character here, and the
    // walk below starts from the character before it.
    if (text[start] === "." && isWordCp(cpBefore(text, start)) && !isWordCp(text.codePointAt(start + 1))) {
        start--;
    }
    // an apostrophe (straight or curly) or a dot between two word
    // characters belongs to the word, the same rule the end walk applies
    // ("don't", "example.com"): the walk back crosses it instead of
    // stopping behind it (Kimi hunt cycle 5, 2026-09-16)
    const joinsWord = (at: number): boolean => {
        const c = text[at - 1];
        return (
            (c === "'" || c === "\u2019" || c === ".") &&
            isWordCp(cpBefore(text, at - 1)) &&
            isWordCp(text.codePointAt(at))
        );
    };
    if (
        !isWordCp(text.codePointAt(start)) ||
        (!isWordCp(cpBefore(text, start)) && !joinsWord(start))
    ) {
        return start;
    }
    for (;;) {
        const cp = cpBefore(text, start);
        if (!isWordCp(cp)) {
            if (joinsWord(start)) {
                start--;
                continue;
            }
            break;
        }
        start -= (cp as number) > 0xffff ? 2 : 1;
    }
    return start;
}

/**
 * A block id at the end of a line, with the spaces in front of it: a "^"
 * and Latin letters, digits, or dashes, the only characters Obsidian allows
 * in one (Obsidian Help, Link to blocks).
 */
const TrailingBlockId = /[ \t]+\^[A-Za-z0-9-]+$/;

/**
 * Where a reference that would land at column `ch` of `line` goes instead
 * when the punctuation right in front of it ends a link-like construct
 * that would take that punctuation in, and the reference with it: in
 * front of the punctuation, if the construct keeps its end there and the
 * reference is live. Otherwise `ch`. Both spots are asked of the note as
 * it would read with the reference written in ("[^1]" stands in for it),
 * so only a press after punctuation that follows a link pays for the two
 * readings.
 */
function inFrontOfTakenPunctuation(reading: NoteReading, lines: readonly string[], line: number, ch: number): number {
    const text = lines[line] ?? "";
    let start = ch;
    while (start > 0 && punctuationAt(text, start - 1)) start--;
    if (start === ch || start === 0 || linkLikeEndAt(reading, line, start - 1)?.ch !== start) return ch;
    // the note with a reference written at column `at` of the line, read
    const withReference = (at: number) => readNote(lines.map((written, i) => (i === line ? `${written.slice(0, at)}[^1]${written.slice(at)}` : written)));
    if (linkLikeEndAt(withReference(ch), line, start - 1)?.ch === start) return ch;
    const inFront = withReference(start);
    const live = inFront.referencesOn(line).some((reference) => reference.start === start);
    return live && linkLikeEndAt(inFront, line, start - 1)?.ch === start ? start : ch;
}

/** Move the insertion point so a footnote goes in only at the end of a
 * word, and never where an escape or an inline-footnote opener would
 * swallow it (safeInsertionCh in insertion-liveness). `reading` is the
 * note as it reads before the press, which says where a link around the
 * caret ends; `lineText` is the caret's line and `lines` the whole note,
 * as written, for a link that ends on a later line. */
export function adjustFootnotePosition(
    cursorPosition: EditorPosition,
    reading: NoteReading,
    lineText: string,
    plugin: FootnotePlugin,
    lines: readonly string[],
) {
    if (plugin.settings.insertAtEndOfWord) {
        // A link whose text runs on past a line break ends on a later line,
        // and the reference lands after it there, as it does after a link
        // on one line (Jason's triage decision Q1, 2026-10-05; hunt
        // 2026-10-05, round 2, pin bug-press-in-two-line-link). The walk
        // past the link's end reads that line as written, as the walk on
        // one line does. Its masked twin (the copy with protected text and
        // addresses blotted out) has a bare address glued after a closing
        // mark blotted out too, so the mark looked like the end of the text
        // and the press landed after it, where a press from the link's
        // last line lands in front of it (hunt 2026-10-06, cycle 5,
        // cluster X4, pin bug-two-line-link-glued-url-masked).
        const link = linkLikeEndAt(reading, cursorPosition.line, cursorPosition.ch);
        if (link !== null && link.line !== cursorPosition.line) {
            const endText = lines[link.line];
            const landing = referenceLandingAfter(endText, link.ch, plugin.settings.footnotePlacement, imageStartsOn(reading, link.line));
            return { line: link.line, ch: safeInsertionCh(endText, landing) };
        }
        // The insertion point is the end of the word, then past the closing
        // marks and punctuation that follow it (the landing convention,
        // referenceLandingAfter: a note on the last word of "some bravo".
        // lands after the quote and the full stop). The plugin's own word
        // walk decides the word, rather than the editor's, because the
        // editor's stops at an apostrophe or a dot inside a word and knows
        // nothing of links (Jason's landing rulings, 2026-09-15). A caret
        // on no word at all stays where it is. The reading says which "!"
        // opens an image or an embed (hunt 2026-10-06, cycle 4, cluster P1).
        const landing = endOfWordOffset(
            lineText,
            cursorPosition.ch,
            plugin.settings.footnotePlacement,
            link?.ch ?? -1,
            imageStartsOn(reading, cursorPosition.line),
        );
        if (landing !== cursorPosition.ch) {
            cursorPosition = { line: cursorPosition.line, ch: landing };
        }
        // An email address takes in a period that a reference follows
        // (docs/obsidian-reading-rules.md D8), so a press after the period
        // that ends one was refused as part of a link. It lands in front of
        // the period instead, under After and Before: "Write to
        // me@example.com." gives "me@example.com[^1]." (Jason's ruling Q30,
        // 2026-10-08; hunt 2026-10-08 cycle 6, cluster Z17). Don't move
        // writes where it is told, so it still refuses there.
        if (plugin.settings.footnotePlacement !== "none") {
            cursorPosition = { line: cursorPosition.line, ch: inFrontOfTakenPunctuation(reading, lines, cursorPosition.line, cursorPosition.ch) };
        }
    }
    // A block id is the " ^water1" at the end of a line that lets other
    // notes link to its paragraph. Obsidian counts it only at the very end,
    // so a reference written after it hid the block, and every link to the
    // paragraph stopped working (docs/obsidian-reading-rules.md D4). A
    // press at the id, or after it, lands in front of it, under every
    // placement (hunt 2026-10-08 cycle 6, cluster Z12, pin
    // bug-press-after-block-id).
    const blockId = lineText.search(TrailingBlockId);
    if (blockId !== -1 && cursorPosition.ch > blockId) {
        cursorPosition = { line: cursorPosition.line, ch: blockId };
    }
    const ch = safeInsertionCh(lineText, cursorPosition.ch);
    if (ch !== cursorPosition.ch) {
        cursorPosition = { line: cursorPosition.line, ch };
    }
    return cursorPosition;
}
