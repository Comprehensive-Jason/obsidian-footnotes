import { inItemDefinitionLabels } from "../parsing/list-item-definitions";
import { Editor, EditorPosition } from "obsidian";

import {
    DefinitionBlock,
    definitionStartLines,
    DocumentScan,
    findDefinitionBlocks,
    maskLineWithScan,
    maskProtectedLines,
    quotedDefinitionLabelAbove,
    scanDocument,
} from "../parsing/markdown-scan";
import {
    definitionLabelWithName,
    footnoteReferenceMatches,
    occurrenceAtCursor,
    referenceAtCursor,
    ReferenceOccurrence,
    referenceOccurrences,
} from "../parsing/footnote-grammar";

// One press's shared, read-only view of the document. It depends on nothing
// but markdown-scan and Obsidian's own types. Split out of the all-in-one
// commands file 2026-08-11.

// Every scan judges the document's masked twin: a copy of it with protected
// text (code, frontmatter) blotted out and every column left where it was.
// That is how a "[^x]" inside a code sample counts as plain text rather
// than a footnote (issue #41).
export function docLines(doc: Editor): string[] {
    const lines: string[] = [];
    for (let i = 0; i < doc.lineCount(); i++) {
        lines.push(doc.getLine(i));
    }
    return lines;
}

/**
 * One press's shared, read-only view of the document (performance item F1).
 *
 * Each step of the cascade used to rebuild the list of lines and re-walk
 * the protection scan for itself, which came to 3–5 passes over the whole
 * document per press. Now every step accepts an optional DocContext,
 * falling back to a fresh one so direct callers and unit tests are
 * unaffected, and the command entry points build exactly ONE per press.
 *
 * Masking is lazy: a single line is masked when something asks for it, and
 * the whole masked twin is built and remembered the first time something
 * needs all of it.
 *
 * The press's own context is built strictly BEFORE any edit the press
 * makes. Creation steps edit last, so it can never go stale within one
 * press. contextOfLines builds the same view over any lines, which is how
 * a creation reads the note as it will be AFTER its edit (see
 * planDefinitionAppend).
 */
export interface DocContext {
    lines: string[];
    scan: DocumentScan;
    /** Line `i` of the masked twin, or "" when `i` is outside the document.
     * Each line is remembered once it has been masked. */
    maskedLine(i: number): string;
    /** The whole masked twin, built once and remembered. */
    maskedLines(): string[];
    /** Which lines start a live definition (definitionStartLines), worked
     * out once and remembered. */
    definitionStarts(): boolean[];
    /** The definition blocks (findDefinitionBlocks), worked out once and
     * remembered: a single press used to walk them two or three times
     * (review C2). */
    blocks(): DefinitionBlock[];
}

/** The names of every footnote definition ("[^x]: …" lines) in the order
 * they appear, at most one per line. A definition inside a code block does
 * not count. */
export function listExistingFootnoteDefinitions(
    doc: Editor,
    ctx: DocContext = docContext(doc),
): string[] {
    return definitionNames(ctx);
}

/** The same list, read from a context alone, for a note that is not in an editor yet (the note as a creation will leave it). */
export function definitionNames(ctx: DocContext): string[] {
    const definitionNames: string[] = [];

    // walk every line looking for definition labels, both the ones at
    // column 0 and the ones inside a blockquote or callout ("> [^x]: …",
    // C22), and collect their names
    const lines = ctx.lines;
    const masked = ctx.maskedLines();
    const starts = ctx.definitionStarts();
    for (let i = 0; i < lines.length; i++) {
        if (!starts[i]) continue;
        // definitionLabelWithName is the one place that matches against the
        // masked twin and then re-slices the name from the raw line. That
        // matters because a code span inside a name masks to NULs
        const hit = definitionLabelWithName(lines[i], masked[i]);
        if (hit) definitionNames.push(hit.name);
    }
    // a definition inside a list item counts too, so the press on its
    // reference navigates instead of appending a second definition
    // (Jason's ruling 1, 2026-09-20)
    for (const hit of inItemDefinitionLabels(lines, ctx.scan, masked, starts)) {
        definitionNames.push(hit.name);
    }
    return definitionNames;
}

export function docContext(doc: Editor): DocContext {
    return contextOfLines(docLines(doc));
}

/** The shared view over `lines`, which need not be in any editor. */
export function contextOfLines(lines: string[]): DocContext {
    const scan = scanDocument(lines);
    const perLine: (string | undefined)[] = new Array<string | undefined>(
        lines.length,
    );
    let full: string[] | null = null;
    const maskedLine = (i: number): string => {
        if (i < 0 || i >= lines.length) return "";
        if (full) return full[i];
        let masked = perLine[i];
        if (masked === undefined) {
            masked = maskLineWithScan(lines, scan, i);
            perLine[i] = masked;
        }
        return masked;
    };
    const maskedLines = (): string[] =>
        full ?? (full = maskProtectedLines(lines, scan));
    let starts: boolean[] | null = null;
    const definitionStarts = (): boolean[] =>
        starts ?? (starts = definitionStartLines(lines, scan, maskedLine));
    let blocks: DefinitionBlock[] | null = null;
    const blocksOf = (): DefinitionBlock[] =>
        blocks ?? (blocks = findDefinitionBlocks(lines, scan, undefined, definitionStarts()));
    return { lines, scan, maskedLine, maskedLines, definitionStarts, blocks: blocksOf };
}

/**
 * Whether line `line` belongs to some footnote's definition: a column-0
 * definition block, or a quoted definition, which forms no block but owns
 * its label line and its quoted continuation lines all the same, or any
 * other definition label line (one after a "%%" closer, say), where a
 * reference in the body nests just the same (Kimi hunt cycle 3,
 * 2026-09-16, the second found by its property). A footnote written on
 * such a line would be nested, which the plugin never creates (ADR 0001).
 * The caret guard asks it of the note before a press, and the liveness
 * check of the note after it (hunt 2026-10-02, cluster R2).
 */
export function insideDefinition(ctx: DocContext, line: number): boolean {
    return (
        ctx.definitionStarts()[line] ||
        ctx.blocks().some((block) => line >= block.start && line <= block.end) ||
        quotedDefinitionLabelAbove(ctx.lines, ctx.scan, ctx.definitionStarts(), (j) => ctx.maskedLine(j), line) >= 0
    );
}

/**
 * The shared "is the caret on a LIVE reference?" lookup. Cascade steps 2–3
 * and the inline commands all begin with it; there were three
 * byte-identical copies of it before 2026-08-25.
 *
 * The RAW line is checked first, as a cheap gate: this runs on every press,
 * masking needs the whole document, and most presses sit on plain text
 * anyway (performance item F1). Only past that gate is the DocContext built
 * and the masked twin consulted, because a "[^x]" inside a code fence or
 * inline code is plain text and the press should fall through to insertion
 * (#41). referenceOccurrences re-slices each name from the raw line, so a
 * code span inside a name cannot leak NULs into it
 * (bug-masked-name-identity).
 *
 * It returns the occurrence together with the context that judged it. Pass
 * that ctx onward, so the press keeps to its one-scan budget.
 */
export function referenceOccurrenceAtCursor(
    lineText: string,
    cursorPosition: EditorPosition,
    doc: Editor,
    ctx?: DocContext,
): { target: ReferenceOccurrence; ctx: DocContext } | null {
    // The gate asks only whether reference-shaped text sits at the caret,
    // so a label-shaped start of the line counts here too: whether it is a
    // definition's label or a lazy label's live reference is decided past
    // the gate, against the document's definition starts (Claude sweep
    // 2026-09-13: a column-0 lazy label never got that far, and a press
    // inside it fell through to creation)
    const rawReferences = footnoteReferenceMatches(lineText, false).map((match) => ({
        footnote: match[0],
        startIndex: match.index ?? 0,
    }));
    // Stryker disable next-line ConditionalExpression, BlockStatement, LogicalOperator: unit tests cannot cheaply tell the two branches apart, but this gate is NOT only about speed - masking can only ever make a "[^…]" match LONGER, because a NUL counts as a name character, so on a line like "[^a`]:`x]" the masked twin invents a phantom reference where the raw line correctly reads a definition label; the raw-line gate is what keeps that phantom out (hunt 2026-08-25, probe-error adjudication, micromark-verified)
    if (referenceAtCursor(rawReferences, cursorPosition.ch) === null) {
        return null;
    }
    ctx ??= docContext(doc);
    const target = occurrenceAtCursor(
        referenceOccurrences(
            lineText,
            ctx.maskedLine(cursorPosition.line),
            ctx.definitionStarts()[cursorPosition.line],
        ),
        cursorPosition.ch,
    );
    return target === null ? null : { target, ctx };
}
