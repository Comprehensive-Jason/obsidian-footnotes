// Plain line handling shared by the commands and the lint rules: a note's
// line endings flattened and put back, a run of lines found, and lines cut
// out of a note without leaving a double gap or turning the lines around
// the cut into something else (it moved here from markdown-scan.ts in step
// 4 of the runtime swap, 2026-10-03, when the rest of that file went).

import { BlockquotePrefix } from "./label-shapes";
import { Definition } from "./note-reading";

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
 * The same goes for the blank lines of a quote (">" and nothing else):
 * two of the same depth left next to each other become one, and one left
 * at the end of its quote goes (hunt 2026-10-02, round 2, cluster D13, pin
 * bug-delete-quoted-definition-separator). Neither changes how the quote
 * reads. A line holding only ">" with no quote line above it is no blank
 * line of a quote: it is a whole quote of its own, empty, and it stays.
 */
export function removeLineRanges(
    lines: string[],
    ranges: readonly { start: number; end: number }[],
): string[] {
    const rangeAtLine = new Map(ranges.map((range) => [range.start, range]));
    const out: string[] = [];
    let mergeBlanks = false;
    // how long `out` was when the last cut was made: the line at
    // out[cutAfter - 1] sat right above that cut
    let cutAfter = -1;
    // whether a cut reaches the last line: the blank line that separated
    // that last block from the text above it would otherwise be left
    // dangling at the end of the note (Kimi and Claude sweeps 2026-09-13)
    const cutReachesEnd = ranges.some((range) => range.end >= lines.length - 1);
    for (let i = 0; i < lines.length; i++) {
        const range = rangeAtLine.get(i);
        if (range) {
            i = range.end;
            mergeBlanks = true;
            cutAfter = out.length;
            continue;
        }
        if (
            mergeBlanks &&
            lines[i] === "" &&
            (out.length === 0 || out[out.length - 1] === "")
        ) {
            continue; // keep merging until a non-blank line arrives
        }
        // a blank quote line right after a cut, under another one of the
        // same depth, is merged the same way
        if (mergeBlanks && blankQuoteLine(lines[i]) && out.length > 0 && sameBlankQuoteLine(out[out.length - 1], lines[i])) {
            continue;
        }
        // a blank quote line the cut left at the end of its quote, with
        // the quote ending in a blank line or the end of the note, goes
        if (mergeBlanks && lines[i] === "" && endsInQuoteBlankLine(out)) {
            out.pop();
        }
        // A cut must not drop a paragraph straight onto a "---" or "==="
        // line, a quoted "> ---" included
        // (bug-blockquote-setext-residue). Markdown would read the two
        // together as a setext heading, turning the stranded text into a
        // heading. A blank separator goes back in only when the two lines
        // have just become neighbours, which is what mergeBlanks means: no
        // blank line between them survived the cut.
        //
        // The marks must end the line: a "=== " or "--- " is never an
        // underline, so a blank line there only split a paragraph the cut
        // had left whole (hunt 2026-10-06, cycle 3, pin
        // bug-underline-regex-too-wide). Up to three spaces in front stay
        // allowed, since this function cannot see a list item's content
        // column, where such a line can be an underline; a blank line too
        // many is the safe mistake.
        if (
            mergeBlanks &&
            out.length > 0 &&
            out[out.length - 1] !== "" &&
            /^\s{0,3}(-+|=+)$/.test(lines[i].replace(BlockquotePrefix, ""))
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
    // A blank quote line at the end goes only when the cut is what left it
    // at the end of its quote: it sat right above the cut, or right above
    // another such line. One that already ended its quote, with a blank
    // line between it and the definitions below, stays. It went when the
    // definitions under it were cut from the end of the note, so the first
    // lint moved the definitions below a quote ending in ">", and the
    // second took the ">" (hunt 2026-10-06, cycle 5, pin
    // bug-quote-trailing-blank-after-definitions).
    if (cutReachesEnd) {
        while (out.length > 0) {
            if (out[out.length - 1] === "") {
                out.pop();
            } else if (out.length === cutAfter && endsInQuoteBlankLine(out)) {
                out.pop();
                cutAfter--;
            } else {
                break;
            }
        }
    }
    return out;
}

/** Whether `line` is a blank line of a quote: quote markers (">") and spaces, nothing else. */
function blankQuoteLine(line: string): boolean {
    return /^ {0,3}>[ >]*$/.test(line) && line.trimEnd().endsWith(">");
}

/**
 * Whether `lines` ends in a blank line of a quote that has more lines above
 * it: a blank quote line right under another quote line. A lone ">" under
 * a blank line, or at the top of the note, is a whole empty quote, which
 * Obsidian draws as an empty quote box, so a cut never takes it. It was
 * taken when a cut reached the end of the note, and a note ending in ">"
 * after its definitions lost the ">" on the second lint, after the first
 * had moved the definitions below it (hunt 2026-10-06, cycle 4, pin
 * bug-lone-quote-marker-deleted).
 */
function endsInQuoteBlankLine(lines: readonly string[]): boolean {
    return lines.length > 1 && blankQuoteLine(lines[lines.length - 1]) && /^ {0,3}>/.test(lines[lines.length - 2]);
}

/** Whether two blank quote lines are of the same quote depth (the same number of ">"). */
function sameBlankQuoteLine(a: string, b: string): boolean {
    return blankQuoteLine(a) && a.split(">").length === b.split(">").length;
}

/**
 * How cutting `definitions` out of `lines` goes: the lines with every label
 * that sits on a list marker's line trimmed back to the marker, and the
 * ranges of whole lines to remove (removeLineRanges). A definition's lines
 * go whole, except on a list marker's line, where only the definition goes
 * and the bullet stays, an empty item, because that is what Obsidian's own
 * delete leaves (Jason, 2026-09-24, on the feature-round sheet; since Jason's ruling 1,
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
