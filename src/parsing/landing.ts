// Where a footnote reference lands after a word: the punctuation and the
// closing marks it steps over, and the link-like constructs it never
// splits. The insert commands' end-of-word adjustment and the punctuation
// lint rule both walk with these, so the two can never disagree about where
// a reference belongs. It is a walk over the text of one line, needing no
// note around it (it moved here from markdown-scan.ts in step 4 of the
// runtime swap, 2026-10-03, when the rest of that file went).

import { escapedAt } from "./footnote-grammar";

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
