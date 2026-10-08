// The shape of a definition's label, "[^name]:" at the start of a line,
// read off the text of one line. Which labels ARE definitions is the note
// reading's to say (note-reading.ts); the shape matters where the reading
// says a line is no definition but the user plainly meant one: a lazy
// label directly under prose, or a label a setext underline turns into a
// heading. The lint names those, fix-lazy repairs them, and a press or a
// deletion treats them as the definitions they were meant to be (it moved
// here from markdown-scan.ts in step 4 of the runtime swap, 2026-10-03,
// when the rest of that file went).

import { NoteReading, readNote } from "./note-reading";

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
 * The label-shaped lines that Obsidian does not read as a definition but a
 * blank line above would make one, each with the label's name as written
 * and whether a setext underline sits right under it.
 *
 * The label must start the line's text inside its containers, at most three
 * spaces in, as a definition's label must: past a quote's marker, and at a
 * list item's content column, wherever that is ("10. item" puts it at
 * column 4). The note reading says where each line's containers end
 * (containerEnd), so the label's shape is read from there. Read from
 * the margin, a label in a nested or wide list item was four spaces in and
 * no label, so the lint neither named nor fixed it, and the orphan rule
 * cut its "[^b]" out (hunt 2026-10-05, pin
 * bug-lazy-label-wide-item-content-column).
 *
 * And its "[^name]" must be read as a live reference, which a lazy
 * label's is. One that is not sits in dead text: inside an inline footnote
 * or an inline HTML tag that runs over a line break (rule E3; hunt
 * 2026-10-05, pin bug-lazy-label-inside-multi-line-inline, where the lint
 * cut an inline footnote in two), in code, or anywhere else Obsidian reads
 * no footnote, and no blank line makes that a definition.
 *
 * Left out besides: a line inside a definition's body, where a blank line
 * would make the label a definition nested in that one, which the plugin
 * never makes (ADR 0001); labels written inside a "%%" comment (hidden
 * text, not a definition one blank line short of working; a reference
 * there is live, so the comment is checked on its own); and labels behind
 * a "%%" on their line, which no blank line can ever make a definition
 * (Kimi hunt cycle 1, 2026-09-16: fix-lazy pushed a blank line in above
 * such a label on every lint).
 *
 * `range`, when given, limits the lines looked at to `from` up to (not
 * including) `to`, and `reading` is the note's reading when the caller
 * already has it: the result gate asks about a few lines of a long note
 * (result-gate.ts).
 */
export function labelShapedLines(lines: string[], range?: { from: number; to: number }, reading: NoteReading = readNote(lines)): { line: number; name: string; underlined: boolean }[] {
    const out: { line: number; name: string; underlined: boolean }[] = [];
    const first = Math.max(0, range?.from ?? 0);
    const last = Math.min(lines.length, range?.to ?? lines.length);
    // where each line starts, to place a label among the comments
    let offset = 0;
    for (let i = 0; i < first; i++) offset += lines[i].length + 1;
    for (let i = first; i < last; offset += lines[i].length + 1, i++) {
        if (reading.labelLines[i] || !lines[i].includes("[^") || reading.definitionAt(i) !== null) continue;
        const textStart = reading.containerEnd(i);
        const hit = definitionLabelWithName(lines[i].slice(textStart), reading.maskedLine(i).slice(textStart));
        if (!hit || hit.label.afterCloser) continue;
        const labelStart = textStart + hit.label.nameStart - 2;
        if (!reading.referencesOn(i).some((reference) => reference.start === labelStart)) continue;
        const at = offset + labelStart;
        if (reading.comments.some((comment) => comment.from <= at && at < comment.to)) continue;
        // a "===" or "---" under the label makes it a heading's text (or,
        // inside a longer paragraph, plain text a blank line above would
        // turn INTO a heading), so a blank line above cannot fix it (Kimi
        // hunt cycle 3, probed in Reading view 2026-09-16: fix-lazy piled
        // twenty blank lines above such a label)
        const underlined = underlinedAt(reading, lines, i);
        out.push({ line: i, name: hit.name, underlined });
    }
    return out;
}

/**
 * Whether the line under the label on line `i` is its setext underline:
 * the "===" or "---" that, once a blank line goes in above the label,
 * makes the label a heading's text instead of a definition. Directly
 * under a one-line paragraph such a line makes a heading already. Under a
 * longer paragraph it is plain text, which a blank line above the label
 * turns into a heading's underline.
 *
 * So the question is answered by reading the note with that blank line
 * in place, the very note fix-lazy would write (a bare ">" line in a
 * quote, as fix-lazy writes it): the label is underlined when that note
 * reads it as no definition but as a heading that the line under it
 * continues. Two conditions come with it, both read off the note as it
 * is. The line under the label must sit in the label's own containers,
 * with none of them starting on it (they may start on the label's line, a
 * label on a list item's marker line), or it is no underline the label owns:
 * a "---" at the left margin under a label lazy in a list item ends the
 * list as a horizontal rule, and a "- ===" starts an item of its own, and
 * Delete footnote everywhere must never cut either with the label. And a
 * quick look at its text comes first, so a label with plain text under it
 * costs no second reading.
 *
 * Before, the line under the label was judged in the containers the label
 * sits in now, which is not where the blank line leaves it. A label lazy
 * in a quote or a list item, at the left margin, has no marker of its own
 * for that container, so the blank line ends the quote or item and the
 * label becomes a top-level definition, while a "> ===" or "  ---" under
 * it stays where it was, no underline at all. And the containers were
 * compared with the marks where blocks start taken out, so a second list
 * item "- ===" read as the label's own item. Both were filed underlined:
 * fix-lazy left the label alone, and Delete footnote everywhere cut the
 * line under it, a list item or a quoted line of the user's (hunt
 * 2026-10-06, cycle 4, pins bug-underline-sibling-list-item and
 * bug-underline-column-zero-lazy-into-container; live Obsidian 1.14.4,
 * 2026-10-06). Reading the trial note also covers what the older checks
 * did by hand: the label at a wide list item's content column (hunt
 * 2026-10-05, round 2, pins bug-underline-judged-from-margin and
 * bug-underlined-label-wide-item), and an indented "  ---" or a "--- "
 * with a space after it, which is no underline (hunt 2026-10-06, cycle 3,
 * pin bug-underline-regex-too-wide).
 */
function underlinedAt(reading: NoteReading, lines: readonly string[], i: number): boolean {
    if (i + 1 >= lines.length || !UnderlineShaped.test(lines[i + 1].replace(/\r$/, ""))) return false;
    if (containersOf(reading.lineBlocks[i]).replace(/\^/g, "") !== containersOf(reading.lineBlocks[i + 1])) return false;
    const markers = (QuoteMarkers.exec(lines[i])?.[1] ?? "").trimEnd();
    const trial = readNote([...lines.slice(0, i), markers, ...lines.slice(i)]);
    // in the trial the label is on line i + 1 and the line under it on i + 2
    const own = ownBlock(trial.lineBlocks[i + 1]);
    return !trial.labelLines[i + 1] && /^\^heading\d$/.test(own) && ownBlock(trial.lineBlocks[i + 2]) === own.slice(1);
}

/**
 * A loose first look at the line under a label: "=" or "-" marks, with
 * nothing but quote markers and spaces around them. Whether the line
 * really underlines the label is the trial reading's to say.
 */
const UnderlineShaped = /^[\s>]*(?:=+|-+)\s*$/;

/**
 * The blockquote markers in front of a label line. Inside a quote, a line
 * holding nothing but those same ">" markers is what counts as a blank
 * line, so the trial's blank line copies them, as fix-lazy's does
 * (src/linting/rules/fix-lazy-definitions.ts).
 */
const QuoteMarkers = /^ {0,3}((?:>[ \t]?)*)/;

/**
 * The containers in one line's entry of lineBlocks, outermost first,
 * without the line's own block. The "^" marks where blocks start stay,
 * so a container that starts on a line (a new list item) never equals one
 * that only carries on.
 */
function containersOf(blocks: string | undefined): string {
    return (blocks ?? "").split(" ").slice(0, -1).join(" ");
}

/** The innermost block in one line's entry of lineBlocks, the line's own, with its "^" when it starts on that line. */
function ownBlock(blocks: string | undefined): string {
    return (blocks ?? "").split(" ").pop() ?? "";
}

/**
 * The lines whose label-shaped start is NOT a definition: lazy paragraph
 * text as far as Obsidian is concerned (the prose-label rule), which a
 * blank line above would make a definition. A label with a setext
 * underline under it is not here (underlinedDefinitionLabelLines).
 * `range` and `reading` as for labelShapedLines.
 */
export function lazyDefinitionLabelLines(lines: string[], range?: { from: number; to: number }, reading?: NoteReading): number[] {
    return labelShapedLines(lines, range, reading)
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
