import { Editor, EditorPosition } from "obsidian";

import { NoteReading, readNote, ReferenceOccurrence } from "../parsing/note-reading";
import { footnoteNameProblem, referenceShapes } from "../parsing/footnote-grammar";

// One press's shared, read-only view of the document. It depends on nothing
// but the parsing modules and Obsidian's own types. Split out of the
// all-in-one commands file 2026-08-11.

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
 * the protection scan for itself, which came to 3 to 5 passes over the whole
 * document per press. Now every step accepts an optional DocContext,
 * falling back to a fresh one so direct callers and unit tests are
 * unaffected, and the command entry points build exactly ONE per press.
 *
 * Everything in it comes from the note reading (note-reading.ts), which
 * parses each distinct text once and remembers it. Masking is lazy: a
 * single line is masked when something asks for it, and the whole masked
 * twin is built and remembered the first time something needs all of it.
 *
 * The press's own context is built strictly BEFORE any edit the press
 * makes. Creation steps edit last, so it can never go stale within one
 * press. contextOfLines builds the same view over any lines, which is how
 * a creation reads the note as it will be AFTER its edit (see
 * planDefinitionAppend).
 */
export interface DocContext {
    lines: string[];
    /** Line `i` of the masked twin, or "" when `i` is outside the document.
     * Each line is remembered once it has been masked. */
    maskedLine(i: number): string;
    /** The whole masked twin, built once and remembered. */
    maskedLines(): readonly string[];
    /** Which lines hold a definition's label, from the note reading. */
    definitionStarts(): boolean[];
    /** The note reading (note-reading.ts): every definition wherever it
     * sits, with its extent and its container. The reading parses each
     * distinct text once and remembers it, so asking again costs nothing
     * (review C2 asked the same of the old block walk). */
    reading(): NoteReading;
}

/** The names of every footnote definition in the order they appear,
 * wherever each sits: at the top level, in a quote or callout, or in a
 * list item (Jason's ruling 1, option a, 2026-10-03). A definition inside a
 * code block does not count. */
export function listExistingFootnoteDefinitions(
    doc: Editor,
    ctx: DocContext = docContext(doc),
): string[] {
    return definitionNames(ctx);
}

/** The same list, read from a context alone, for a note that is not in an editor yet (the note as a creation will leave it). */
export function definitionNames(ctx: DocContext): string[] {
    return ctx.reading().definitions.map((definition) => definition.name);
}

export function docContext(doc: Editor): DocContext {
    return contextOfLines(docLines(doc));
}

/** The shared view over `lines`, which need not be in any editor. */
export function contextOfLines(lines: string[]): DocContext {
    let reading: NoteReading | null = null;
    const readingOf = (): NoteReading => reading ?? (reading = readNote(lines));
    let starts: boolean[] | null = null;
    const definitionStarts = (): boolean[] => starts ?? (starts = [...readingOf().labelLines]);
    return {
        lines,
        maskedLine: (i) => readingOf().maskedLine(i),
        maskedLines: () => readingOf().maskedLines(),
        definitionStarts,
        reading: readingOf,
    };
}

/**
 * Whether line `line` belongs to some footnote's definition, its label line
 * or any line of its body, wherever the definition sits: at the top level,
 * in a quote or callout, in a list item, or after a "%%" closer (Jason's
 * ruling 1, option a, 2026-10-03; the quoted case was Kimi hunt cycle 3,
 * 2026-09-16, the in-item one hunt 2026-10-02, cluster R3). A footnote
 * written on such a line would be nested, which the plugin never creates
 * (ADR 0001). The caret guard asks it of the note before a press, and the
 * liveness check of the note after it (hunt 2026-10-02, cluster R2).
 */
export function insideDefinition(ctx: DocContext, line: number): boolean {
    return ctx.reading().definitionAt(line) !== null;
}

/**
 * The shared "is the caret on a reference?" lookup. Cascade steps 2 and 3
 * and the inline commands all begin with it; there were three
 * byte-identical copies of it before 2026-08-25.
 *
 * The note reading says which references are live and where (the runtime
 * swap, step 3, 2026-10-03): a "[^x]" inside code, inside an inline
 * footnote, or in a link's label is plain text, so the press falls through
 * to creation (#41), and a lazy label's "[^x]" is a live reference. The
 * name is the one written in the note, casing and all.
 *
 * One more thing counts: text shaped like a reference whose name cannot
 * work, such as "[^my note]". Obsidian reads it as plain text, so the
 * reading holds no reference there, but the user plainly meant one, and
 * the cascade says why the name cannot work rather than writing a new
 * footnote into its brackets.
 *
 * It returns the occurrence together with the context that judged it. Pass
 * that ctx onward, so the press reads the note once.
 */
export function referenceOccurrenceAtCursor(
    lineText: string,
    cursorPosition: EditorPosition,
    doc: Editor,
    ctx?: DocContext,
): { target: ReferenceOccurrence; ctx: DocContext } | null {
    // a line with no "[^" holds no reference: most presses sit on such a
    // line, and this keeps the reading out of their path (performance item
    // F1)
    if (!lineText.includes("[^")) return null;
    ctx ??= docContext(doc);
    const { line, ch } = cursorPosition;
    const target =
        ctx.reading().referenceAt(line, ch) ??
        referenceShapes(lineText, ctx.maskedLine(line)).find(
            (shape) => ch > shape.start && ch < shape.end && footnoteNameProblem(shape.name) !== null,
        ) ??
        null;
    return target === null ? null : { target, ctx };
}
