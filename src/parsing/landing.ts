// Where a footnote reference lands after a word: the punctuation and the
// closing marks it steps over, and the link-like constructs it never
// splits. The insert commands' end-of-word adjustment and the punctuation
// lint rule both walk with these, so the two can never disagree about where
// a reference belongs. The walk goes over the text of one line; only the
// question of where a link ends asks the note reading (it moved here from
// markdown-scan.ts in step 4 of the runtime swap, 2026-10-03, when the rest
// of that file went).

import { readCell } from "./cell-reading";
import { escapedAt } from "./footnote-grammar";
import { NoteReading, readNote } from "./note-reading";

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
 * It lives in this file, beside the walk that steps over it, because both
 * its users, cursor-motion and the lint rule, ask that walk too.
 */
export const TrailingPunctuationChars = ".,;:!?\u2026。，、；：！？．｡､⋯‥‼⁇⁈⁉";

/** No column holds an image: the images a walk takes when it is handed none. */
const NoImages: ReadonlySet<number> = new Set();

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
 *
 * The "!" that opens an image, "![alt](pic.png)", or an embed, "![[file]]",
 * is no exclamation mark either. Stepping over it put the reference
 * between the "!" and the "[", where the image or embed falls apart into a
 * stray "!" and a plain link (hunt 2026-10-06, cycle 3, pin
 * bug-punctuation-splits-image-bang). Whether a "!" opens one is the note
 * reading's answer, which a caller hands in as `images`, the columns where
 * the line draws an image or an embed (imageStartsOn): "![x]" is an image
 * only when the note has a "[x]: pic.png" line, and without one it is an
 * exclamation mark and bracketed text, so in "Wow![x] more" a reference
 * still lands after the "!" (hunt 2026-10-06, cycle 4, cluster P1, pin
 * bug-bang-before-undefined-brackets: every "!" right in front of a "["
 * was taken for an image's). Every caller in the plugin hands its images
 * in, the lint's punctuation rule included; left out, no "!" opens an
 * image (the guess from the text alone, every "!" in front of a "[" that
 * does not start "[^", went once the lint asked the reading too).
 */
export function punctuationAt(text: string, i: number, images: ReadonlySet<number> = NoImages): boolean {
    if (images.has(i)) return false;
    return i >= 0 && i < text.length && TrailingPunctuationChars.includes(text[i]) && !escapedAt(text, i);
}

/**
 * Where the word in front of column `at` of `text` ends, when only spaces
 * stand between the two; `at` itself when no word ends there. A footnote
 * reference belongs right after its word, so the spaces a user typed in
 * front of one ("water [^1].") go with the reference wherever the
 * reference moves, or is cut out (Jason's ruling Q35, 2026-10-09; his
 * attach ruling of 2026-09-08 covers the space the plugin writes).
 *
 * The spaces are spaces and tabs. With `typographic`, the no-break spaces
 * French puts before ";", ":", "!", and "?" (U+00A0 and the narrow
 * U+202F) count too: a reference moved back in front of "Vraiment ?" lands
 * on the word, "Vraiment[^1] ?", the space staying with the "?" (ruling
 * Q35, which settles G9 with it).
 *
 * No word ends there when what comes before the spaces is punctuation, a
 * table's "|", or the line's block syntax: `textStart` is the column where
 * the line's text begins (NoteReading.blockSyntaxEnd), so the space after
 * "- " or "> " is never taken.
 */
export function wordEndBefore(text: string, at: number, textStart: number, typographic = false): number {
    const space = typographic ? /[ \t\u00a0\u202f]/ : /[ \t]/;
    let end = at;
    while (end > textStart && space.test(text[end - 1])) end--;
    if (end === at || end <= textStart || text[end - 1] === "|" || punctuationAt(text, end - 1)) return at;
    return end;
}

/**
 * The columns of `line` where `reading` draws an image or an embed: the
 * column of its "!", for every link that starts with one and that the
 * note draws (drawnAsLink, judged with `linkLabels`). This is the `images`
 * the landing walk takes (punctuationAt).
 */
export function imageStartsOn(reading: NoteReading, line: number, linkLabels: ReadonlySet<string> = reading.linkLabels): ReadonlySet<number> {
    const starts = new Set<number>();
    for (const link of reading.links) {
        if (link.startLine === line && reading.maskedLine(line)[link.start] === "!" && drawnAsLink(link, linkLabels)) starts.add(link.start);
    }
    return starts;
}

/** imageStartsOn for a table cell's own text, read as the note holds it (readCell), as offsets into `text`; `linkLabels` are the labels of the note's link reference definitions, as for cellLinkLikeEndAt. */
export function cellImageStarts(text: string, linkLabels: ReadonlySet<string> = new Set()): ReadonlySet<number> {
    const cell = readCell(text);
    return new Set([...imageStartsOn(cell.reading, 0, linkLabels)].map((column) => cell.offset(column)));
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
 * Korean and Dutch writing share (Jason's ask on a manual pass,
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
 * `images` are the columns where the line draws an image or an embed, as
 * punctuationAt takes them.
 *
 * A walk that would end right after the "]" of bracketed text that is no
 * link stops in front of that "]" instead, inside the brackets: "[see p.
 * 5][^1]" is a reference link to Obsidian, labelled "^1", so the footnote
 * would not be live, while "[see p. 5[^1]]" is, as "none" already lands it
 * (Jason's ruling Q2, option (a), 2026-10-07; pin
 * spec-placement-last-word-in-brackets). Before, the press refused with
 * the link notice. "[see p. 5]." under "after" still lands after the
 * period, where the reference is live.
 */
export function referenceLandingAfter(text: string, end: number, placement: FootnotePlacement = "after", images?: ReadonlySet<number>): number {
    if (placement === "none") return end;
    // the last "]" the walk stepped over as a closing mark, or -1
    let bracketClose = -1;
    const landed = (at: number) => (at === bracketClose + 1 && bracketClose !== -1 && closesBracketedText(text, bracketClose) ? bracketClose : at);
    let at = end;
    for (;;) {
        if (at >= text.length) return landed(at);
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
        if (!ClosingMarkChars.includes(c) && !punctuationAt(text, at, images)) return landed(at);
        if (placement === "before" && punctuationAt(text, at, images)) {
            // "before": the run of punctuation from here is stepped over
            // only when a closing mark follows it (the period inside
            // "quoted." or 「句子。」), and that mark must be a real closer
            // (markRunEnd); otherwise the reference stops in front of the
            // punctuation. The mark is judged the way the walk judges it
            // below, a run of emphasis markers as one, so "。**重点**" is
            // punctuation and then a bold OPENER, and the reference stays
            // in front of the "。" (hunt 2026-10-02, pin
            // bug-placement-before-punctuation-before-emphasis: one
            // character after the mark was looked at, the second "*", so
            // the press landed after the "。" and every lint flipped the
            // reference from one side to the other).
            let runEnd = at;
            while (punctuationAt(text, runEnd, images)) runEnd++;
            if (
                runEnd >= text.length ||
                !ClosingMarkChars.includes(text[runEnd]) ||
                markRunEnd(text, runEnd) === -1
            ) {
                return landed(at);
            }
            at = runEnd;
            continue;
        }
        const next = markRunEnd(text, at);
        if (next === -1) return landed(at);
        if (c === "]") bracketClose = at;
        at = next;
    }
}

/** Whether the "]" at `close` closes a "[" before it on the line, counting nested square brackets and skipping escaped ones. */
function closesBracketedText(text: string, close: number): boolean {
    if (escapedAt(text, close)) return false;
    let depth = 0;
    for (let i = close; i >= 0; i--) {
        if (escapedAt(text, i)) continue;
        if (text[i] === "]") depth++;
        else if (text[i] === "[" && --depth === 0) return true;
    }
    return false;
}

/**
 * The closing marks that only ever close: the closing brackets of every
 * kind and the CJK closing quotes. A straight or curly quote can also open
 * or sit inside a word ("Marx's"), and an emphasis marker can also open
 * ("*important*"), but one of these closes whatever comes after it. So a
 * word glued to its far side does not make it an opener: Chinese and
 * Japanese have no spaces, and the "）" of "他说（来源）然后" touches the
 * next word (hunt 2026-10-02, pin bug-placement-cjk-glued-closing-bracket:
 * the press landed inside the bracket, and the lint left a reference
 * inside "「来源[^1]」然后").
 */
const OnlyClosingChars = ")]}」』）】〕》〉｣］｝｠〗〙〛〞〟";

/**
 * Where the walk goes on after the closing mark or punctuation character
 * at `at`, or -1 when it is no closer and the walk stops in front of it.
 *
 * A mark or punctuation character glued to a word character on its far
 * side is not a closer: an emphasis OPENER ("[^1]*important*"), an
 * opening quote, or punctuation inside a word ("Marx's", "U.S."). Walking
 * past it would put the reference inside the next word or break the
 * emphasis (Kimi and Claude sweeps 2026-09-13; Jason's landing rulings
 * 2026-09-15). Emphasis markers come in runs ("**"), so the run is judged
 * as one. A mark that only ever closes (OnlyClosingChars) is a closer
 * whatever follows it.
 */
function markRunEnd(text: string, at: number): number {
    const c = text[at];
    if (OnlyClosingChars.includes(c)) return at + 1;
    let runEnd = at + 1;
    if ("*_~=".includes(c)) {
        while (runEnd < text.length && text[runEnd] === c) runEnd++;
    }
    return isWordCharAt(text, runEnd) ? -1 : runEnd;
}

/** Whether the code point at `i` is a letter, digit, or mark. */
function isWordCharAt(text: string, i: number): boolean {
    const cp = text.codePointAt(i);
    return cp !== undefined && /[\p{L}\p{N}\p{M}]/u.test(String.fromCodePoint(cp));
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

/**
 * The index of the ")" that closes a link's "(" at `open`, or -1. Round
 * brackets inside the address are counted, so they must balance, and a
 * backslash escapes the next character. Two parts of the tail are skipped
 * whole, since a ")" inside them closes nothing (CommonMark's link
 * destination and link title): an address written in angle brackets
 * "<...>", and a title, which follows a space or a tab and is quoted with
 * '"' or "'" or held in round brackets (hunt 2026-10-05, pin
 * bug-landing-paren-in-link-title: '[w](u "a)b")' stopped at the ")" in
 * the title).
 */
function balancedParenEnd(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        // an escaped bracket is a literal character of the destination,
        // not a closer (GLM hunt cycle 4, 2026-09-16: the landing walk
        // stopped at it and wrote the reference into the address)
        if (c === "\\") {
            i++;
            continue;
        }
        if (depth === 1 && c === "<" && /^[ \t]*$/.test(text.slice(open + 1, i))) {
            // an address in angle brackets ends at its ">"
            const close = unescapedIndex(text, ">", i + 1);
            if (close === -1) return -1;
            i = close;
            continue;
        }
        if (depth === 1 && (c === '"' || c === "'" || c === "(") && (text[i - 1] === " " || text[i - 1] === "\t")) {
            // a title runs to its closing quote or bracket
            const close = unescapedIndex(text, c === "(" ? ")" : c, i + 1);
            if (close !== -1) {
                i = close;
                continue;
            }
        }
        if (c === "(") depth++;
        else if (c === ")") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** The index of the first `mark` at or after `from` that no backslash escapes, or -1. */
function unescapedIndex(text: string, mark: string, from: number): number {
    for (let i = from; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === mark) return i;
    }
    return -1;
}

/** A link-like construct as the note reading finds it (NoteReading.links). */
type LinkLike = NoteReading["links"][number];

/**
 * Whether the note draws `link` as a link. Every kind is drawn but a
 * reference link or image whose label no "[label]: url" line carries: the
 * reader takes any "[...]" for a reference link, but one with no such line
 * is bracketed text that Obsidian shows as it is written (CommonMark
 * 0.31.2, section 6.3; 6d37374). `linkLabels` are the labels the note's
 * link reference definitions carry (NoteReading.linkLabels).
 */
export function drawnAsLink(link: LinkLike, linkLabels: ReadonlySet<string>): boolean {
    return link.lookup === undefined || linkLabels.has(link.lookup);
}

/**
 * The shape of every link `reading` draws (drawnAsLink), judged with the
 * link labels `linkLabels`: its text in the masked twin, its lines joined
 * by line breaks. `keep`, when given, says which links to count: the
 * result gate leaves out the links in text the edit meant to take out or
 * write (result-gate.ts). (Moved here from insertion-liveness.ts on
 * 2026-10-07, so the result gate can use it too.)
 */
export function drawnLinkShapes(reading: NoteReading, linkLabels: ReadonlySet<string>, keep?: (link: NoteReading["links"][number]) => boolean): string[] {
    const shapes: string[] = [];
    for (const link of reading.links) {
        if (!drawnAsLink(link, linkLabels) || (keep && !keep(link))) continue;
        const lines: string[] = [];
        for (let line = link.startLine; line <= link.endLine; line++) {
            const text = reading.maskedLine(line);
            lines.push(text.slice(line === link.startLine ? link.start : 0, line === link.endLine ? link.end : text.length));
        }
        shapes.push(lines.join("\n"));
    }
    return shapes;
}

/**
 * The end of the link-like construct that holds column `ch` of `line`, as
 * `reading` reads the note, or null when it sits in none: an inline link
 * "[text](url)", a reference link "[text][ref]", an image, a wikilink, an
 * autolink "<...>", a bare web address, or an email address, from its
 * first character up to its last. The end is the line the construct ends
 * on and the column just past it. A reference belongs after the whole
 * construct, never inside it (Jason's landing rulings, 2026-09-15).
 *
 * The reading knows where each one ends because it reads the line the way
 * Obsidian does, so a ")" inside a link's quoted title or its "<...>"
 * address, an email address, and a reference image's alt text need no
 * walk of their own (hunt 2026-10-05, pins
 * bug-landing-paren-in-link-title and bug-email-and-image-alt-false-refusal;
 * the hand-written walk this replaced knew only some of those shapes). A
 * construct whose text runs on past a line break ends on a later line,
 * and a press inside it lands after it there, as it does after a link on
 * one line (Jason's triage decision Q1, 2026-10-05; hunt 2026-10-05,
 * round 2, pin bug-press-in-two-line-link: the press used to land inside
 * the link's text).
 *
 * A reference link or image counts only when the note draws it
 * (drawnAsLink). Bracketed text that is no link may hold a reference: a
 * caret in "some" of "[some text]" lands at the end of the word,
 * "[some[^1] text]", under every placement (Jason, 2026-10-05; pin
 * bug-dont-move-bracketed-text). Taking the end of such text sent the
 * press past the "]", where "[some text][^1]" reads as a reference link
 * and the press was refused. `linkLabels` are the labels the note's link
 * reference definitions carry; a table cell's reading has none of its
 * own, so a press in a cell hands in the note's.
 */
export function linkLikeEndAt(
    reading: NoteReading,
    line: number,
    ch: number,
    linkLabels: ReadonlySet<string> = reading.linkLabels,
): { line: number; ch: number } | null {
    const link = reading.links.find(
        (candidate) =>
            drawnAsLink(candidate, linkLabels) &&
            (candidate.startLine < line || (candidate.startLine === line && candidate.start <= ch)) &&
            (candidate.endLine > line || (candidate.endLine === line && ch < candidate.end)),
    );
    return link === undefined ? null : { line: link.endLine, ch: link.end };
}

/** linkLikeEndAt for one line's text read on its own, as a note of one line: the end of the construct holding `offset`, or -1. */
export function lineLinkLikeEndAt(text: string, offset: number): number {
    return linkLikeEndAt(readNote([text]), 0, offset)?.ch ?? -1;
}

/**
 * linkLikeEndAt for a table cell's own text, read as the note holds it
 * (readCell): the end of the construct holding `offset`, as an offset into
 * `text`, or -1. `linkLabels` are the labels of the note's link reference
 * definitions, which give a reference link in the cell its address:
 * Reading view draws "[some text]" in a cell as a link when the note has a
 * "[some text]: http://u" line (Obsidian 1.14.4, asked live on 2026-10-05;
 * hunt 2026-10-05, round 2, pin bug-cell-defined-reference-link-press).
 */
export function cellLinkLikeEndAt(text: string, offset: number, linkLabels: ReadonlySet<string> = new Set()): number {
    const cell = readCell(text);
    const end = linkLikeEndAt(cell.reading, 0, cell.column(offset), linkLabels);
    return end === null ? -1 : cell.offset(end.ch);
}
