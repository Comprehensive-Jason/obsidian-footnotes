import { Definition, readNote } from "./note-reading";
// The basic scanning pieces that the whole-document footnote transforms
// share: reindex, move-to-bottom, and after-punctuation. Nothing in this
// file touches an Editor. Lines go in, facts about them come out.
//
// What a note's lines ARE (definitions, protected text, the masked twin,
// table rows) comes from the note reading (note-reading.ts); the readers
// here that answer those questions are thin ones over it, kept for the
// callers and tests written against the hand-written scanner, whose walk
// was replaced in step 2 of the runtime swap (2026-10-03). What stays is
// the plugin's own grammar around footnotes: punctuation and landing,
// labels, line endings, and cutting lines out.

/**
 * A footnote definition at the start of a line ("[^x]: …"). Up to three
 * spaces of indent are allowed, the same as any other block start; at four
 * spaces the line is indented code instead.
 *
 * Ground truth in Obsidian's Reading view (2026-09-09): "  [^1]: x" renders
 * as a definition, even sitting directly under another definition, where it
 * starts a NEW footnote rather than continuing the one above (review A2).
 */
// A name holding whitespace is refused by Obsidian's parser outright, so
// "[^my note]: text" is a line of prose, never a label: no rule may treat
// it as a definition to move, renumber, or delete (Claude sweep 2026-09-13;
// the reference pattern stays permissive so the invalid-name alert can
// still see such shapes and say so).
const DefinitionStart = /^ {0,3}\[\^([^[\]\s]+)\]:/;

/**
 * The trailing punctuation an insert hops over on its way to the end of a
 * word. The footnote-after-punctuation lint rule moves references around
 * this very same set of characters, so the two features can't disagree
 * about where a reference belongs. It is the ASCII punctuation plus the
 * CJK fullwidth forms 。，、；：！？ (Jason, 2026-08-10), plus, since
 * 2026-09-21 (the CJK coverage audit of 2026-09-19), the fullwidth full
 * stop ．, the halfwidth ideographic stop ｡ and comma ､ that some input
 * methods emit instead, the Chinese ⋯ and Japanese ‥ ellipses, and the
 * doubled marks ‼ ⁇ ⁈ ⁉. Word-internal marks stay out on purpose: the
 * Japanese prolonged sound mark ー, the middle dots ・ ･, the fullwidth
 * hyphen －, and the wave dash and tilde 〜 ～, which usually mean a range.
 *
 * It lives in this file because both users of it, cursor-motion and the
 * lint rule, already sit above this leaf module. The import cycle that
 * first forced it here is gone, but no better shared home turned up.
 */
export const TrailingPunctuationChars = ".,;:!?\u2026。，、；：！？．｡､⋯‥‼⁇⁈⁉";

/**
 * Whether the character at `i` is punctuation in the sense every walk
 * uses: one of TrailingPunctuationChars, and not escaped by a backslash.
 * An escaped mark such as the "\." in "Version 2\." is a literal
 * character of the word, not punctuation (CommonMark's backslash
 * escapes). This matters because a reference moved in front of an escaped
 * mark lands right after the backslash, which then escapes the
 * reference's own bracket and turns it into plain text. Every walk asks
 * this one question, so none of them can disagree about what a
 * punctuation run is (hunt 2026-10-02, pin
 * bug-placement-before-onto-backslash).
 */
export function punctuationAt(text: string, i: number): boolean {
    return i >= 0 && i < text.length && TrailingPunctuationChars.includes(text[i]) && !escapedAt(text, i);
}

/**
 * Where a footnote reference goes relative to the punctuation after a word
 * (T5 of the 2026-09 feature round; Jason's ruling 2026-09-20: one global
 * setting, no per-language table). "after" is today's behaviour and the
 * default: English, Taiwanese, Korean and Dutch writing. "before" is
 * mainland Chinese, Japanese, French, Italian, Portuguese, Polish and the
 * EU style guide. "none" leaves the reference at the end of the word and
 * the lint rule idle, for conventions that place per mark (Russian,
 * Polish) or per sense (German), and for notes mixing scripts. "after" and
 * "before" step over closing marks, since every convention found puts the
 * marker after a closing quotation bracket, never inside it; "none" steps
 * over nothing at all, so that the value means what it says and a user
 * who wants no automation has one value to pick (Jason, 2026-09-22).
 */
export type FootnotePlacement = "after" | "before" | "none";

/**
 * The closing marks a footnote reference also steps past: closing quotes
 * (straight, curly, and the CJK corner brackets), closing brackets of every
 * kind, and the markers that close bold, italics, highlight, and
 * strikethrough. Together with TrailingPunctuationChars they make up the
 * landing convention below. The halfwidth and fullwidth CJK brackets ｣ ］
 * ｝ ｠ 〗 〙 〛 and the prime quotation marks 〞 〟 joined on 2026-09-21
 * (the CJK coverage audit of 2026-09-19). Opening halves are absent on
 * purpose: a reference never steps over an opening bracket.
 */
export const ClosingMarkChars = "\"'’”)]}」』）】〕》〉*_~=｣］｝｠〗〙〛〞〟";

/**
 * Where a footnote reference belongs after the word ending at `end`: past
 * every closing mark and punctuation character that follows, so a note on
 * the last word of a quoted, bracketed, or emphasized phrase lands OUTSIDE
 * the phrase and after its punctuation:
 *
 *     This is "some bravo".   ->   This is "some bravo".[^1]
 *     see (bravo).            ->   see (bravo).[^1]
 *     This is **some bravo**. ->   This is **some bravo**.[^1]
 *
 * That is the Chicago Manual of Style's rule, which English, Taiwanese,
 * Korean and Dutch writing share (Jason's ask, former sheet 01,
 * 2026-09-09; it was called "the one every major style guide shares"
 * until the 2026-09-20 research found that mainland Chinese, Japanese,
 * French and the EU style guide put the marker before the punctuation).
 * `placement` picks the convention (see FootnotePlacement): "before"
 * stops the walk in front of punctuation, except a punctuation run that
 * a closing mark follows, which is stepped over with the mark so the
 * reference still lands outside the quote; "none" does not walk at all,
 * closing marks included (Jason, 2026-09-22). A link inside the word is
 * the caller's business (linkLikeEndAt), so a reference never splits one
 * under "none" either.
 *
 * A markdown link's "(url)" tail right after a "]" is stepped over whole,
 * so the reference never splits "[text](url)". A space, a letter, or an
 * opening bracket (the start of a following reference) ends the walk.
 */
export function referenceLandingAfter(text: string, end: number, placement: FootnotePlacement = "after"): number {
    if (placement === "none") return end;
    let at = end;
    for (;;) {
        if (at >= text.length) return at;
        const c = text[at];
        if (c === "]" && text[at + 1] === "(") {
            // a link's "(url)" tail, with any round brackets INSIDE the
            // address balanced, as in a Wikipedia disambiguation link
            // (Claude sweep 2026-09-13); an unclosed tail ends the walk
            const close = balancedParenEnd(text, at + 1);
            if (close === -1) return at + 1;
            at = close + 1;
            continue;
        }
        if (c === "]" && text[at + 1] === "[" && text[at + 2] !== "^") {
            // a reference-style link's "[]" or "[ref]" tail, stepped over
            // whole the same way: "[text][ref]" written as "[text][^1][ref]"
            // is no link any more (hunt 2026-10-02, pin
            // bug-landing-reference-style-link). A "[^" there is the next
            // footnote's reference, which ends the walk as before.
            const close = balancedBracketEnd(text, at + 1);
            if (close !== -1) {
                at = close + 1;
                continue;
            }
        }
        if (!ClosingMarkChars.includes(c) && !punctuationAt(text, at)) return at;
        if (placement === "before" && punctuationAt(text, at)) {
            // "before": the run of punctuation from here is stepped over
            // only when a closing mark follows it (the period inside
            // "quoted." or 「句子。」), and that mark must be a real closer,
            // not glued to the next word; otherwise the reference stops in
            // front of the punctuation
            let runEnd = at;
            while (punctuationAt(text, runEnd)) runEnd++;
            if (
                runEnd >= text.length ||
                !ClosingMarkChars.includes(text[runEnd]) ||
                isWordCharAt(text, runEnd + 1)
            ) {
                return at;
            }
            at = runEnd;
            continue;
        }
        // A mark or punctuation character glued to a word character on its
        // far side is not a closer: an emphasis OPENER ("[^1]*important*"),
        // an opening quote, or punctuation inside a word ("Marx's",
        // "U.S."). Walking past it would put the reference inside the next
        // word or break the emphasis (Kimi and Claude sweeps 2026-09-13;
        // Jason's landing rulings 2026-09-15). Emphasis markers come in
        // runs ("**"), so the run is judged as one.
        let runEnd = at + 1;
        if ("*_~=".includes(c)) {
            while (runEnd < text.length && text[runEnd] === c) runEnd++;
        }
        if (isWordCharAt(text, runEnd)) return at;
        at = runEnd;
    }
}

/** Whether the code point at `i` is a letter, digit, or mark. */
function isWordCharAt(text: string, i: number): boolean {
    const cp = text.codePointAt(i);
    return cp !== undefined && /[\p{L}\p{N}\p{M}]/u.test(String.fromCodePoint(cp));
}

/** Whether the character at `index` has an odd run of backslashes in front of it: escaped, literal text. (footnote-grammar has the same helper; it sits above this module, so a copy keeps this one a leaf.) */
function escapedAt(line: string, index: number): boolean {
    let backslashes = 0;
    for (let j = index - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
    return backslashes % 2 === 1;
}

/** The index of the "]" that closes the "[" at `open`, counting nested square brackets and skipping escaped ones, or -1. */
function balancedBracketEnd(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
            continue;
        }
        if (text[i] === "[") depth++;
        else if (text[i] === "]") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** The index of the ")" that closes the "(" at `open`, counting nested round brackets, or -1. */
function balancedParenEnd(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        // an escaped bracket is a literal character of the destination,
        // not a closer (GLM hunt cycle 4, 2026-09-16: the landing walk
        // stopped at it and wrote the reference into the address)
        if (text[i] === "\\") {
            i++;
            continue;
        }
        if (text[i] === "(") depth++;
        else if (text[i] === ")") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * The end of the link-like construct that contains `offset`, or -1 when it
 * sits in none: a markdown link "[text](url)" with its address balanced, a
 * wikilink "[[note|alias]]", a bare URL, or an autolink "<scheme://...>"
 * (the closing ">" included). A reference belongs after the whole
 * construct, never inside it (Jason's landing rulings, 2026-09-15).
 */
export function linkLikeEndAt(text: string, offset: number): number {
    const link = /\[[^\]\n]*\]\(/g;
    for (let m = link.exec(text); m; m = link.exec(text)) {
        const close = balancedParenEnd(text, m.index + m[0].length - 1);
        if (close === -1) continue;
        if (offset >= m.index && offset < close + 1) return close + 1;
    }
    const wikilink = /\[\[[^\]\n]*\]\]/g;
    for (let m = wikilink.exec(text); m; m = wikilink.exec(text)) {
        if (offset >= m.index && offset < m.index + m[0].length) return m.index + m[0].length;
    }
    const url = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>]+/g;
    for (let m = url.exec(text); m; m = url.exec(text)) {
        let end = m.index + m[0].length;
        if (offset < m.index || offset >= end) continue;
        // an autolink's ">" belongs to it
        if (text[m.index - 1] === "<" && text[end] === ">") end++;
        return end;
    }
    return -1;
}
/**
 * Which lines are rows of a table, as the note reading finds them
 * (NoteReading.tableRowLines): the header, the delimiter row, and the body
 * rows of every table Obsidian renders, quoted ones included. A table
 * inside a footnote's definition belongs to the definition and is left
 * out, and so is anything inside code or a comment, which is no table.
 */
export function tableRowLinesOf(lines: string[]): boolean[] {
    return [...readNote(lines).tableRowLines];
}

/**
 * What the plugin still asks of a whole-note scan, read off the note
 * reading (note-reading.ts) since step 2 of the runtime swap (2026-10-03):
 * the hand-written walk that used to work these out is gone. The commands
 * ask the reading itself; this shape stays for the tests written against
 * the scanner.
 */
export interface DocumentScan {
    /** Lines protected through and through (NoteReading.protectedLines). */
    isProtected: boolean[];
    /** Lines of a "%%" block comment, its opening and closing lines included (NoteReading.commentLines). */
    inCommentBlock: boolean[];
    /** A line appended at the end of the note would be swallowed by a region that never closes (NoteReading.openRegionFrom). */
    endsProtected: boolean;
    /** Line `i` lies in the region that never closes, from the line it opens on to the end of the note. */
    endsProtectedAt: boolean[];
}

/** The scan of `lines`, read off the note reading. */
export function scanDocument(lines: string[]): DocumentScan {
    const reading = readNote(lines);
    const open = reading.openRegionFrom;
    return {
        isProtected: [...reading.protectedLines],
        inCommentBlock: [...reading.commentLines],
        endsProtected: open !== -1,
        endsProtectedAt: lines.map((_, i) => open !== -1 && i >= open),
    };
}

/** The lines protected through and through (NoteReading.protectedLines). */
export function protectedLines(lines: string[]): boolean[] {
    return [...readNote(lines).protectedLines];
}

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

/** The reading of a cell's text as the one cell of a one-row table: a table needs its delimiter row, and "| " goes in front, so the text starts at column 2. */
function cellReading(text: string) {
    return readNote([`| ${text} |`, "| --- |"]);
}

/**
 * The document's masked twin (NoteReading.maskedLine): every line with its
 * protected text blotted out as "\0", every column where it was. The second
 * argument is accepted for the tests written when this took the scanner's
 * scan; it is not read.
 */
export function maskProtectedLines(lines: string[], _scan?: object): string[] {
    return [...readNote(lines).maskedLines()];
}

/** Line `i` of the document's masked twin, or "" when `i` is outside the document. The note reading masks one line at a time, so this costs one line once the note is read. */
export function maskedLineAt(lines: string[], i: number): string {
    return readNote(lines).maskedLine(i);
}

/**
 * `text` with its Windows "\r\n" line endings flattened to plain "\n", plus
 * the ending to put back afterwards. The whole-document transforms all work
 * in "\n" and restore the note's original endings on the way out. Obsidian
 * edits notes in place, so a transform must not quietly flip a synced
 * Windows file over to "\n", the way stripping and forgetting would.
 */
export function normalizeEol(text: string): {
    text: string;
    eol: "\n" | "\r\n";
} {
    return text.includes("\r\n")
        ? { text: text.replace(/\r\n/g, "\n"), eol: "\r\n" }
        : { text, eol: "\n" };
}

/** Puts the note's original line endings back on a transform's result. */
export function restoreEol(text: string, eol: "\n" | "\r\n"): string {
    return eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

// The blockquote or callout markers at the start of a line ("> ", "> > ",
// and so on). A fenced code block can sit inside a blockquote or callout,
// and then its delimiter lines carry these markers too.
//
// Each ">" marker owns one optional space after it, and the NEXT marker may
// sit up to 3 further spaces in. That is the same walk blockquoteDepth
// does. The old pattern, /^(?: {0,3}>)+ ?/, did not eat the space that
// belongs to each marker, so a perfectly legal ">    > [^1]: x" (the gap of
// 4 being the marker's own space plus 3 of indent) lost its second marker,
// and the label behind it went invisible (2026-08-11 review, bug #5).
const BlockquotePrefix = /^(?: {0,3}> ?)+/;

/**
 * The footnote definition label on `line`, or null when the line carries
 * none. The label may sit at column 0, or behind blockquote or callout
 * markers, as in "> [^x]: …" (Jason's ruling, 2026-08-10: footnote
 * creation, navigation, and lint all work inside blockquotes and callouts).
 *
 * The positions returned index into the SAME line that was passed in, so a
 * caller that matched against the masked twin can cut the name back out of
 * the raw line. It has to: a code span inside the name masks to NULs.
 */
export function definitionLabelIn(line: string): DefinitionLabel | null {
    let prefix = line.match(BlockquotePrefix)?.[0].length ?? 0;
    // A "%%" right after the markers is the closer of a block comment, and
    // the text after it is outside the comment: a label there is a
    // definition to Obsidian ("%% [^3]: def" and "> %% [^4]: def" both
    // render; Jason's verification 2026-09-15). Whether the "%%" really
    // closes a block is the scan's to say, so definitionStartLines checks
    // afterCloser against the comment-block facts before it starts one.
    const afterCloser = line.startsWith("%%", prefix);
    if (afterCloser) prefix += 2;
    const match = line.slice(prefix).match(DefinitionStart);
    if (!match) return null;
    // whatever DefinitionStart matched before the "[^": the 0 to 3 spaces
    // of indent
    const indent = match[0].length - match[1].length - "[^]:".length;
    const nameStart = prefix + indent + 2;
    return {
        nameStart,
        nameEnd: nameStart + match[1].length,
        labelEnd: prefix + match[0].length,
        quoted: prefix > 0,
        ...(afterCloser ? { afterCloser: true } : {}),
    };
}

/**
 * Where a definition label sits on its line: the span of the name, the end
 * of the whole "[^name]:" label, and whether a blockquote or callout marker
 * comes before it. A quoted label is a live definition on its own line, but
 * it is never part of a column-0 definition BLOCK (case C22).
 */
export interface DefinitionLabel {
    nameStart: number;
    nameEnd: number;
    labelEnd: number;
    quoted: boolean;
    /** The label sits after a "%%" on its line: the closer of a block comment, or a "%%" that is not a closer at all, which the scan tells apart. Such a label never forms a block and is never cut out as an orphan, since its line holds the closer. */
    afterCloser?: true;
}

/**
 * The definition label on `line`, matched against its MASKED twin (a copy
 * with protected text blanked out) but with the name cut back out of the
 * RAW line. It is the label-side counterpart of referenceOccurrences below,
 * and it carries the same rule (bug-masked-name-identity): masking turns a
 * code span inside the name into NULs, and a name carrying NULs could never
 * equal the raw reference it must pair with.
 *
 * The label's positions work on either twin, because masking never changes
 * a line's length. Null when the masked line carries no label.
 *
 * (rename-footnote keeps a variant of its own that checks the raw line
 * first: it needs the RAW label's positions before the masked twin exists,
 * and only then confirms against the twin that the label is live.)
 */
export function definitionLabelWithName(line: string, masked: string) {
    const label = definitionLabelIn(masked);
    // Stryker disable next-line ConditionalExpression: a label visible on the masked twin is always visible at the SAME positions on the raw line (masking only writes NULs, and NULs can't spell "[^" or "]:"), so forcing the fallback is behavior-identical - the fast path is perf
    if (label) return { label, name: line.slice(label.nameStart, label.nameEnd) };
    // The masked twin can LOSE a real label. A backtick inside the NAME can
    // pair with one in the body, as in "[^a`b]: c`d", and masking that code
    // span turns the label's own "]:" into NULs, so DefinitionStart stops
    // matching. Yet GFM carves the label out BEFORE it tokenizes inline
    // syntax, and renders a definition named "a`b" (hunt 2026-08-25,
    // verified against micromark; bug-code-span-name-hides-definition).
    //
    // So check the RAW line again, but only when the label's own opening
    // "[^" survived masking. A masked opener means the label starts inside
    // a protected region (a fence line, an open math or comment run), where
    // a definition-shaped string is plain text and not a label at all.
    const raw = definitionLabelIn(line);
    if (!raw) return null;
    const bracketAt = raw.nameStart - 2;
    if (
        masked.slice(bracketAt, raw.nameStart) !==
        line.slice(bracketAt, raw.nameStart)
    ) {
        return null;
    }
    return { label: raw, name: line.slice(raw.nameStart, raw.nameEnd) };
}

/**
 * Finds the first exact, fully unprotected run of `runLines` inside
 * `lines`, and gives back the index of the run's LAST line, or -1 when
 * there is none.
 *
 * The section heading setting is markdown that can span several lines, such
 * as "---\n## Footnotes". Both the insert flow (the heading slot in
 * buildDefinitionAppend) and the move-to-bottom rule find the whole run
 * through THIS function. Two hand-written copies would let their answers
 * drift apart, and with them the promise that running lint again changes
 * nothing (2026-08-11 review, for cleanliness).
 */
export function findLineRunEnd(
    lines: string[],
    isProtected: readonly boolean[],
    runLines: string[],
    // A "%%" block comment's lines are left unprotected so that references
    // inside them still bind their definitions, so on its own the
    // protected test lets a commented-out heading anchor the definitions:
    // the append then wrote inside the comment, and move-to-bottom broke
    // the comment apart to gather under it (Claude sweep 2026-09-13). A
    // caller with a scan passes its inCommentBlock, and those lines never
    // match.
    inCommentBlock: readonly boolean[] = [],
): number {
    for (let i = 0; i + runLines.length <= lines.length; i++) {
        const matches = runLines.every(
            (runLine, k) =>
                !isProtected[i + k] && !inCommentBlock[i + k] && lines[i + k] === runLine,
        );
        if (matches) return i + runLines.length - 1;
    }
    return -1;
}

/**
 * The lines with the given ranges cut out, both ends of each range
 * included. Where a cut leaves two blank lines next to each other, they
 * collapse into one, so removing a block never leaves a double gap behind.
 */
export function removeLineRanges(
    lines: string[],
    ranges: readonly { start: number; end: number }[],
): string[] {
    const rangeAtLine = new Map(ranges.map((range) => [range.start, range]));
    const out: string[] = [];
    let mergeBlanks = false;
    // whether a cut reaches the last line: the blank line that separated
    // that last block from the text above it would otherwise be left
    // dangling at the end of the note (Kimi and Claude sweeps 2026-09-13)
    const cutReachesEnd = ranges.some((range) => range.end >= lines.length - 1);
    for (let i = 0; i < lines.length; i++) {
        const range = rangeAtLine.get(i);
        if (range) {
            i = range.end;
            mergeBlanks = true;
            continue;
        }
        if (
            mergeBlanks &&
            lines[i] === "" &&
            (out.length === 0 || out[out.length - 1] === "")
        ) {
            continue; // keep merging until a non-blank line arrives
        }
        // A cut must not drop a paragraph straight onto a "---" or "==="
        // line, a quoted "> ---" included
        // (bug-blockquote-setext-residue). Markdown would read the two
        // together as a setext heading, turning the stranded text into a
        // heading. A blank separator goes back in only when the two lines
        // have just become neighbours, which is what mergeBlanks means: no
        // blank line between them survived the cut.
        if (
            mergeBlanks &&
            out.length > 0 &&
            out[out.length - 1] !== "" &&
            /^\s{0,3}(-+|=+)\s*$/.test(lines[i].replace(BlockquotePrefix, ""))
        ) {
            out.push("");
        }
        // Nor may a cut promote a "---" to the very START of the document.
        // There it reads as a frontmatter opener and swallows the live
        // prose up to the next divider, and reindex with orphan deletion
        // then removes the definitions whose references it had hidden
        // (bug-stranded-frontmatter). A blank line in front keeps it an
        // ordinary divider.
        if (mergeBlanks && out.length === 0 && lines[i] === "---") {
            out.push("");
        }
        mergeBlanks = false;
        out.push(lines[i]);
    }
    if (cutReachesEnd) {
        while (out.length > 0 && out[out.length - 1] === "") out.pop();
    }
    return out;
}

/**
 * How cutting `definitions` out of `lines` goes: the lines with every label
 * that sits on a list marker's line trimmed back to the marker, and the
 * ranges of whole lines to remove (removeLineRanges). A definition's lines
 * go whole, except on a list marker's line, where only the definition goes
 * and the bullet stays, an empty item, because that is what Obsidian's own
 * delete leaves (Jason, 2026-09-24, sheet 19; since Jason's ruling 1,
 * option a, 2026-10-03, for every rule that cuts a definition). Pass only
 * definitions that are `removable`. `lines` comes back as the same array
 * when nothing was trimmed.
 */
export function definitionCuts(
    lines: string[],
    definitions: readonly Definition[],
): { lines: string[]; ranges: { start: number; end: number }[] } {
    let trimmed = lines;
    const ranges: { start: number; end: number }[] = [];
    for (const definition of definitions) {
        const before = lines[definition.start].slice(0, definition.labelStart);
        // a removable label has only indentation, quote markers, and list
        // markers before it, so anything else there is a list marker
        if (/[^\s>]/.test(before)) {
            if (trimmed === lines) trimmed = lines.slice();
            trimmed[definition.start] = before;
            if (definition.end > definition.start) ranges.push({ start: definition.start + 1, end: definition.end });
        } else {
            ranges.push({ start: definition.start, end: definition.end });
        }
    }
    return { lines: trimmed, ranges: ranges.sort((a, b) => a.start - b.start) };
}

/**
 * Which lines hold the label of a definition, as the note reading finds
 * them (note-reading.ts): one entry per line, true where some definition's
 * label sits, wherever the definition is (Jason's ruling 1, option a,
 * 2026-10-03). A label-shaped line that the reading does not call a
 * definition is lazy paragraph text (lazyDefinitionLabelLines below).
 *
 * The second and third arguments are accepted for the callers written when
 * this was the scanner's own walk, which needed the scan and the masked
 * twin; the reading needs neither, and they are not read.
 */
export function definitionStartLines(lines: string[], _scan?: object, _maskedAt?: (i: number) => string): boolean[] {
    return [...readNote(lines).labelLines];
}

/**
 * The definitions whose lines are their own to move or cut: the ones at the
 * top level of the note with nothing but indentation before their label
 * (Definition.movable), in document order, each running from its label line
 * to the last line of its body. These are the blocks move-to-bottom
 * gathers and reindex reorders; a definition in a quote, a list item, or
 * another footnote, or one that shares its label line with other text,
 * stays where it is. Every definition, whatever holds it, is in
 * readNote(lines).definitions.
 *
 * Each comes back as its name and its lines only. The arguments after
 * `lines` are accepted for the callers written when this was the scanner's
 * own walk; they are not read.
 */
export function findDefinitionBlocks(
    lines: string[],
    _scan?: object,
    _masked?: string[],
    _starts?: boolean[],
): { name: string; start: number; end: number }[] {
    return readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }));
}

/**
 * The label-shaped lines that Obsidian does not read as a definition, each
 * with whether a setext underline sits right under it. Left out: protected
 * lines, labels written inside a "%%" comment (hidden text, not a
 * definition one blank line short of working), and labels behind a "%%"
 * on their line, which no blank line can ever make a definition (Kimi hunt
 * cycle 1, 2026-09-16: fix-lazy pushed a blank line in above such a label
 * on every lint).
 */
function labelShapedLines(lines: string[]): { line: number; underlined: boolean }[] {
    const reading = readNote(lines);
    const out: { line: number; underlined: boolean }[] = [];
    // where each line starts, to place a label among the comments
    let offset = 0;
    for (let i = 0; i < lines.length; offset += lines[i].length + 1, i++) {
        if (reading.labelLines[i] || reading.protectedLines[i] || !lines[i].includes("[^")) continue;
        const hit = definitionLabelWithName(lines[i], reading.maskedLine(i));
        if (!hit || hit.label.afterCloser) continue;
        const at = offset + hit.label.nameStart - 2;
        if (reading.comments.some((comment) => comment.from <= at && at < comment.to)) continue;
        // a "===" or "---" under the label makes it a heading's text (or,
        // inside a longer paragraph, plain text a blank line above would
        // turn INTO a heading), so a blank line above cannot fix it (Kimi
        // hunt cycle 3, probed in Reading view 2026-09-16: fix-lazy piled
        // twenty blank lines above such a label)
        const underlined = i + 1 < lines.length && !reading.protectedLines[i + 1] && underlineUnder(lines[i], lines[i + 1]);
        out.push({ line: i, underlined });
    }
    return out;
}

/** How many quote markers start the line, the way BlockquotePrefix reads them. */
function quoteDepth(line: string): number {
    return (line.match(BlockquotePrefix)?.[0].match(/>/g) ?? []).length;
}

/**
 * Whether `next`, the line under `line`, is shaped like a setext underline
 * ("===", "---", "-") at the same quote depth. Directly under a one-line
 * paragraph it makes a heading; under a longer paragraph it is plain text
 * that a blank line above `line` would turn into a heading's underline.
 */
function underlineUnder(line: string, next: string): boolean {
    const text = next.replace(/\r$/, "");
    return quoteDepth(text) === quoteDepth(line) && /^ {0,3}(?:=+|-+) *$/.test(text.replace(BlockquotePrefix, ""));
}

/**
 * The lines whose label-shaped start is NOT a definition: lazy paragraph
 * text as far as Obsidian is concerned (the prose-label rule), which a
 * blank line above would make a definition. A label with a setext
 * underline under it is not here (underlinedDefinitionLabelLines). Any
 * arguments after `lines` are accepted for the tests written when this
 * took the scanner's facts; they are not read.
 */
export function lazyDefinitionLabelLines(lines: string[], ..._unused: unknown[]): number[] {
    return labelShapedLines(lines)
        .filter((label) => !label.underlined)
        .map((label) => label.line);
}

/**
 * The lines of labels that a setext underline ("===", "---", "--") sits
 * directly under. Obsidian reads the label as a heading, or as plain text
 * when it continues a longer paragraph, and a blank line between the label
 * and the underline is what makes it a definition.
 */
export function underlinedDefinitionLabelLines(lines: string[], ..._unused: unknown[]): number[] {
    return labelShapedLines(lines)
        .filter((label) => label.underlined)
        .map((label) => label.line);
}
