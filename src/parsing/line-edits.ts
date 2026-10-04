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
