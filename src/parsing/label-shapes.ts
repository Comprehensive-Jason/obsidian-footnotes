// The shape of a definition's label, "[^name]:" at the start of a line,
// read off the text of one line. Which labels ARE definitions is the note
// reading's to say (note-reading.ts); the shape matters where the reading
// says a line is no definition but the user plainly meant one: a lazy
// label directly under prose, or a label a setext underline turns into a
// heading. The lint names those, fix-lazy repairs them, and a press or a
// deletion treats them as the definitions they were meant to be (it moved
// here from markdown-scan.ts in step 4 of the runtime swap, 2026-10-03,
// when the rest of that file went).

import { readNote } from "./note-reading";

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
export const BlockquotePrefix = /^(?: {0,3}> ?)+/;

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
    // closes a block is the note reading's to say, which is why a lazy
    // label (labelShapedLines below) never counts one after a "%%".
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
    /** The label sits after a "%%" on its line: the closer of a block comment, or a "%%" that is not a closer at all, which the note reading tells apart. Such a label is never read as a lazy one. */
    afterCloser?: true;
}

/**
 * The definition label on `line`, matched against its MASKED twin (a copy
 * with protected text blanked out) but with the name cut back out of the
 * RAW line (bug-masked-name-identity): masking turns a code span inside
 * the name into NULs, and a name carrying NULs could never equal the raw
 * reference it must pair with.
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
 * underline under it is not here (underlinedDefinitionLabelLines).
 */
export function lazyDefinitionLabelLines(lines: string[]): number[] {
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
export function underlinedDefinitionLabelLines(lines: string[]): number[] {
    return labelShapedLines(lines)
        .filter((label) => label.underlined)
        .map((label) => label.line);
}
