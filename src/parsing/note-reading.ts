// The note reading: the one parse of a note the way Obsidian reads it,
// remembered, and asked by every part of the plugin that needs to know
// which definitions a note holds and where each one ends.
//
// footnote-facts.ts reads the facts off the tree obsidian-markdown.ts
// builds. This file adds two things on top. It takes the note as the
// plugin holds it, an array of lines, and it remembers its last few
// answers, keyed by the exact text: one key press reads the same note
// several times (the cascade's steps, the lint's rules), and parsing a
// long note takes a noticeable moment, so only the first read parses.
//
// It also parses a note in parts, and remembers each part by its text. A
// press reads the note three times (before the edit, with the new
// reference, and with the new definition), each a different text, and a
// parse of a 5,600-line note took about a tenth of a second on a desktop,
// several times that on a phone. An edit changes one part, so a read after
// an edit parses only that part again (the speed brief, 2026-10-03). How a
// note is cut into parts, and why the parts read exactly as the whole note
// does, is explained at notePartFacts below.
//
// Jason's ruling 1, option a (2026-10-03): a definition is a definition
// wherever it sits, at the top level, in a quote or callout, in a list
// item, or inside another footnote. Each one carries its container, and
// only a "movable" one is ever moved (see DefinitionFact in
// footnote-facts.ts).
//
// Protected text comes from this reading too (step 2 of the runtime swap,
// 2026-10-03): which stretches are code, math, comments, frontmatter, and
// the like, the masked twin every scan judges against, and the per-line
// facts the commands ask (which lines are protected through and through,
// which belong to a "%%" block comment, whether the note ends inside a
// region that never closes). The hand-written scanner's walk that used to
// work these out is gone.

import { DefinitionFact, FootnoteFacts, partFacts } from "./footnote-facts";
import { frontmatterEnd } from "./obsidian-markdown";

/** A definition as the reading gives it: name, label line and columns, last line, container. */
export type Definition = DefinitionFact;

/**
 * A "[^name]" on a line: the name as written, casing and all (fold case to
 * compare two names), the column of its "[", and the column just past its
 * "]".
 */
export interface ReferenceOccurrence {
    name: string;
    start: number;
    end: number;
}

/** An inline footnote "^[...]" on a line: the column of its "^" and the column of its closing "]". */
interface InlineNoteSpan {
    open: number;
    close: number;
}

/** One note, read once. */
export interface NoteReading {
    /** Every definition in the note, wherever it sits, in the order of their labels. */
    readonly definitions: readonly Definition[];
    /** The definitions whose lines are their own to move or cut (Definition.movable), in the same order: the blocks move-to-bottom gathers and reindex reorders. */
    readonly blocks: readonly Definition[];
    /** Every reference, with whether it is live. */
    readonly references: FootnoteFacts["references"];
    /** The stretches of protected text: code, math, comments, frontmatter, and the like. */
    readonly protectedSpans: FootnoteFacts["protectedSpans"];
    /** Every link, reference link, image, and wikilink, in the order the note reads them (see insideLink). */
    readonly links: FootnoteFacts["links"];
    /** One entry per line: true where the label of some definition sits on the line. Shared by every caller of the same text, so never changed. */
    readonly labelLines: boolean[];
    /** The definition whose label sits on `line` (the first, when one line holds two), or null. */
    labelOn(line: number): Definition | null;
    /** The innermost definition whose lines, label line to last line, take in `line`, or null. */
    definitionAt(line: number): Definition | null;
    /**
     * The column where the block syntax at the start of `line` ends and its
     * text begins: past quote markers, list markers and task boxes, the
     * indentation of a list item's lines, a callout's marker, a footnote's
     * label, and a heading's "#" marks; 0 when the line starts with its
     * text. Infinity for a line that is block syntax to its end: a thematic
     * break, a setext underline, a heading with no text, and a list item or
     * a callout whose marker has nothing after it, not even a space ("-",
     * "1.", "> [!note]-"), where text written at the end would undo the
     * marker.
     */
    blockSyntaxEnd(line: number): number;
    /**
     * Line `line` of the masked twin: the line as written, with every
     * character of protected text blotted out as "\0" and every column left
     * where it was, so a scan over it sees no code while every position it
     * finds is still right in the real line. A line protected through and
     * through is all "\0". The text of a "%%" comment stays, since a
     * reference inside one is live (Jason's ruling A1, reaffirmed
     * 2026-10-03), and so do a link's brackets and parentheses, so the
     * landing walk still sees a link's tail. "" for a line outside the note.
     */
    maskedLine(line: number): string;
    /** The whole masked twin, one entry per line, built once. */
    maskedLines(): readonly string[];
    /**
     * One entry per line: true where the line is protected text through and
     * through: a line of a code block (its fence lines included), a math
     * block, an HTML block, or the frontmatter, and a line wholly inside a
     * stretch of inline code, math, or HTML comment that runs over several
     * lines. A line that only starts or ends such a stretch keeps its live
     * part, so it is not counted, and neither is a "%%" comment's line.
     */
    readonly protectedLines: readonly boolean[];
    /** One entry per line: true where the line is a row of a table, its header and delimiter row included, as Obsidian renders tables (rules C1 to C5); a table inside a footnote's definition belongs to the definition and is left out. */
    readonly tableRowLines: readonly boolean[];
    /** One entry per line: true on the lines of a "%%" block comment, its opening and closing lines included. A definition there is hidden; a reference there is live. */
    readonly commentLines: readonly boolean[];
    /** The "%%" comments, block and inline, as stretches of the note: a label written inside one defines nothing Obsidian shows. */
    readonly comments: readonly FootnoteFacts["protectedSpans"][number][];
    /**
     * Whether a stretch of protected text that began on an earlier line
     * runs on into the start of `line`: an open fence, math block, HTML
     * comment or block, or a code span over several lines. A caret at
     * column 0 of such a line sits inside it.
     */
    regionOpenAt(line: number): boolean;
    /**
     * Where the note ends inside a region that never closes: the line the
     * region starts on, or -1 when it ends in the open. Such a region (an
     * unclosed fence, "$$" block, HTML comment or block, "%%" comment, or
     * a link definition's label left open by a "[" with no "]") swallows
     * anything written after the note's last line, so a definition
     * appended there would be hidden. Worked out by asking the reading of
     * the note with a definition appended after a blank line, which is
     * exactly that question.
     */
    readonly openRegionFrom: number;
    /** One entry per line: the blocks the line belongs to, outermost first, marked where each starts (FootnoteFacts.lineBlocks). */
    readonly lineBlocks: readonly string[];
    /** The stretches of protected text and "%%" comments that touch `line`, each as its kind, with a "^" where it starts on this line, in order. */
    lineSpans(line: number): readonly string[];
    /** The live references on `line`, by name in lower case, in order. */
    lineReferences(line: number): readonly string[];
    /**
     * The live references on `line`, in order (the runtime swap, step 3,
     * 2026-10-03). A reference is live where Obsidian reads one: not in
     * protected text, not escaped, not inside an inline footnote (rule E3),
     * not a link's text or label ("[Smith][^1]" is a link), and never a
     * definition's own label, which defines a footnote rather than pointing
     * at one. A lazy label's "[^x]" is a live reference, as it renders. A
     * name holding a space or a tab is no reference at all, so such text is
     * not here.
     */
    referencesOn(line: number): readonly ReferenceOccurrence[];
    /**
     * The live reference on `line` whose brackets strictly hold column `ch`,
     * or null. The caret right after the "]" or right before the "[" is
     * outside, so a press there makes a new footnote next to it instead of
     * jumping (issue #49).
     */
    referenceAt(line: number, ch: number): ReferenceOccurrence | null;
    /** The "[^name]" part of every definition label on `line`, in order: where a rename rewrites the label's name. */
    labelsOn(line: number): readonly ReferenceOccurrence[];
    /** The inline footnotes on `line` that no other inline footnote holds, in order, each wholly on the line. */
    inlineNotesOn(line: number): readonly InlineNoteSpan[];
    /**
     * The inline footnote "^[...]" on `line` whose brackets hold column
     * `ch` (from just after its "^" through its closing "]"), the innermost
     * when one sits in another, or null. Obsidian matches an inline
     * footnote's brackets before it reads the text inside them, and a
     * bracket inside a code span does not count, so the reading, not a
     * bracket count on the line, says where one is.
     */
    inlineNoteAt(line: number, ch: number): { open: number; close: number } | null;
    /**
     * Whether column `ch` of `line` falls inside a link-like construct: an
     * inline link, a reference link, an image, or a wikilink, from its first
     * character up to its last. A "[^name]" whose "[" sits there is read as
     * part of the link, not as a footnote: "[sic][^1]" is a reference link
     * whose label is "^1" (Jason's ruling on its refusal notice,
     * 2026-10-04).
     */
    insideLink(line: number, ch: number): boolean;
}

/**
 * How an edit may have changed a line it touched, for linesReadAlike:
 * "none" for a line the edit left alone, "cut" for one it only took text
 * out of (a reference, a definition's label after a list marker), and
 * "rewrite" for one whose text it replaced (a reference turned into an
 * inline footnote).
 */
export type LineEdit = "none" | "cut" | "rewrite";

/**
 * Whether `after` reads as many live references and as many definitions as
 * `before`: a rename must leave every footnote a footnote. A name that
 * gains a "$" (a footnote-prefix "a$") can pair with a dollar earlier on
 * its line: "$6 [^ch-2]" is a price and a reference, "$6 [^a$ch-2]" is
 * math to Obsidian, and the footnote is gone (found by the conservation
 * property, the runtime swap step 2, 2026-10-03).
 */
export function keepsEveryFootnote(before: readonly string[], after: readonly string[]): boolean {
    const count = (lines: readonly string[]) => {
        const reading = readNote(lines);
        return `${reading.references.filter((reference) => reference.live).length}:${reading.definitions.length}`;
    };
    return count(before) === count(after);
}

/** Whether every entry of `part` is in `whole`, as many times. */
function within(part: readonly string[], whole: readonly string[]): boolean {
    const left = new Map<string, number>();
    for (const item of whole) left.set(item, (left.get(item) ?? 0) + 1);
    for (const item of part) {
        const n = left.get(item) ?? 0;
        if (n === 0) return false;
        left.set(item, n - 1);
    }
    return true;
}

/**
 * Whether line `j` of `after` reads as line `i` of `before` did, as far as
 * the edit between the two allows (the reclassification guards of the
 * orphan rules, Delete footnote everywhere, and the conversions; the
 * runtime swap, step 2, 2026-10-03).
 *
 * A line the edit left alone must read exactly as before: the same blocks
 * around it and starting on it, the same protected text and "%%" comments,
 * the same live references. A line the edit only cut text out of may lose
 * things but gain none: its blocks are the ones it had, or the outer ones
 * of them (an emptied line keeps only its containers, a list marker's line
 * whose definition went keeps only the item), and it holds no protected
 * text and no reference it did not hold. So "#[^9] tail" may not become a
 * heading, "[Smith][^1](2020)" may not become a link, and "[[^1]^2]" may
 * not become a reference to footnote 2. A line whose text was replaced
 * must stay in the same blocks; what is inside it is the edit's own.
 */
export function linesReadAlike(before: NoteReading, i: number, after: NoteReading, j: number, edit: LineEdit): boolean {
    const blocksBefore = before.lineBlocks[i] ?? "";
    const blocksAfter = after.lineBlocks[j] ?? "";
    if (edit === "rewrite") return blocksBefore === blocksAfter;
    if (edit === "none") {
        // a blank line has nothing to read: which container it falls in
        // (the end of one list item or the gap before the next) changes
        // nothing, and a change to a block around it shows on that block's
        // own lines
        if (before.maskedLine(i).trim() === "" && after.maskedLine(j).trim() === "" && !before.protectedLines[i] && !after.protectedLines[j]) return true;
        return (
            blocksBefore === blocksAfter &&
            before.lineSpans(i).join(" ") === after.lineSpans(j).join(" ") &&
            before.lineReferences(i).join(" ") === after.lineReferences(j).join(" ")
        );
    }
    // the blocks after are the outer part of the blocks before
    if (blocksAfter !== "" && blocksBefore !== blocksAfter && !blocksBefore.startsWith(blocksAfter + " ")) return false;
    return within(after.lineSpans(j), before.lineSpans(i)) && within(after.lineReferences(j), before.lineReferences(i));
}

/** How many notes the reading remembers. A press reads the note as it is and as it will be after the edit, a lint passes each rule's output to the next, and asking where an unclosed region starts reads the note with a line added, so a handful covers them. */
const CacheSize = 8;

/** The remembered readings, the most recently used last. A Map keeps its keys in the order they were added. */
const cache = new Map<string, NoteReading>();

/** How many readings have been built since the plugin loaded (one per distinct text), for the tests that check the cache. */
let readings = 0;

/** How many readings have been built so far. Each one parses only the parts of its note that no recent reading had. */
export function parseCount(): number {
    return readings;
}

/** What the part memory holds for one stretch of text: its facts (null when it does not end cleanly) and the last reading that used it. */
interface RememberedPart {
    facts: FootnoteFacts | null;
    usedBy: number;
}

/**
 * The remembered parts, keyed by their text. A key starts with two marks:
 * whether the part starts the note (only there is frontmatter read) and
 * whether its last line is borrowed from the next part (see partFacts).
 */
const parts = new Map<string, RememberedPart>();

/** How many parts have been parsed since the plugin loaded, and how many of those were tried as a part and did not end cleanly. */
const partCounts = { parsed: 0, unclean: 0 };

/** How many parts have been parsed so far, and how many of them did not end cleanly, so that a longer part was tried; for the tests and the speed measurements. */
export function partParseCounts(): { parsed: number; unclean: number } {
    return { ...partCounts };
}

/**
 * How many readings back a remembered part may last have been used before
 * it is forgotten: the parts of the last eight readings stay. A lint reads
 * five or six texts, among them each rule's output and the guards' trial
 * texts, so with four a lint's renamed note was forgotten by the next lint
 * and parsed afresh, about 190 parts on a 5,600-line note (the runtime
 * swap step 2, 2026-10-03).
 */
const PartMemory = 8;

/**
 * A line as the parser should see it. A line may end in a stray "\r" when a
 * caller split Windows text on "\n" alone; it is dropped, as the scanner
 * drops it. A "\r" anywhere else would read as a line break of its own and
 * shift every line after it, so it becomes a space, which keeps every
 * column where it was.
 */
function cleanLine(line: string): string {
    return line.replace(/\r$/, "").replace(/\r/g, " ");
}

/** Whether a line holds nothing but spaces and tabs. */
function isBlank(line: string): boolean {
    return /^[ \t]*$/.test(line);
}

/**
 * How sparsely the places where a part could start are used: about one in
 * eight. Every parse has a cost of its own (setting up the parser, the
 * borrowed line), so a note cut into parts of a line or two parsed about
 * twice as slowly as the whole note at once. On the speed-test notes, one
 * place in eight made a first read, with nothing remembered, about as fast
 * as one parse of the whole note, while a read after an edit still parses
 * only a few dozen lines (measured 2026-10-03).
 */
const PartSpread = 8;

/**
 * Whether a place where a part could start is used. It is decided by the
 * line's own text, a small hash of its first 32 characters, and not by
 * where the line sits, so an edit never moves the part starts around it:
 * the parts before and after an edit stay the ones already remembered.
 */
function usedAsPartStart(line: string): boolean {
    let hash = 0;
    const end = Math.min(line.length, 32);
    for (let i = 0; i < end; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
    // a final mix, so that every character moves the result
    return (Math.imul(hash, 0x9e3779b1) >>> 0) % PartSpread === 0;
}

/**
 * The lines where a part of the note starts. A part may start at a line
 * that starts in its first column (not indented, so not the continuation
 * of a definition, a list item, or indented code) after a blank line, or at
 * any line that starts with a label "[^", the way definitions are written
 * one under another. These are only places to try: whether the note really
 * breaks there is for the parse to say (partFacts). A line starting with a
 * byte order mark is left out, since the parser drops one only at the very
 * start of the note, and so is every line up to the end of the
 * frontmatter, which only the note's first part may read whole. Of the
 * places left, about one in eight is used (usedAsPartStart).
 */
function partStarts(lines: readonly string[], firstAllowed: number): number[] {
    const starts: number[] = [];
    for (let line = Math.max(1, firstAllowed); line < lines.length; line++) {
        const first = lines[line].charAt(0);
        if (first === "" || first === " " || first === "\t" || first === "\uFEFF") continue;
        if ((isBlank(lines[line - 1]) || lines[line].startsWith("[^")) && usedAsPartStart(lines[line])) starts.push(line);
    }
    return starts;
}

/**
 * The facts of one part, `from` to `to` (exclusive, the borrowed line
 * included), from the part memory or by parsing it. `lineStarts` gives each
 * line's offset in `text`, with one more entry for the end of the text.
 */
function rememberedPart(text: string, lineStarts: readonly number[], from: number, to: number, borrowsLine: boolean, reading: number): FootnoteFacts | null {
    const partText = text.slice(lineStarts[from], lineStarts[to] - 1);
    const key = (from === 0 ? "s" : "p") + (borrowsLine ? "+" : ".") + partText;
    const known = parts.get(key);
    if (known) {
        known.usedBy = reading;
        return known.facts;
    }
    partCounts.parsed++;
    const facts = partFacts(partText, from === 0, borrowsLine);
    if (facts === null) partCounts.unclean++;
    parts.set(key, { facts, usedBy: reading });
    return facts;
}

/** Adds a part's facts to the note's, moved down by the lines and characters before the part. */
function addPart(into: FootnoteFacts, part: FootnoteFacts, lines: number, offset: number): void {
    for (const definition of part.definitions) into.definitions.push({ ...definition, start: definition.start + lines, end: definition.end + lines });
    for (const reference of part.references) into.references.push({ ...reference, line: reference.line + lines });
    for (const span of part.protectedSpans) {
        into.protectedSpans.push({ ...span, from: span.from + offset, to: span.to + offset, startLine: span.startLine + lines, endLine: span.endLine + lines });
    }
    for (const syntax of part.blockSyntax) into.blockSyntax.push({ ...syntax, line: syntax.line + lines });
    for (const row of part.tableRows) into.tableRows.push(row + lines);
    for (const blocks of part.lineBlocks) into.lineBlocks.push(blocks);
    for (const note of part.inlineNotes) into.inlineNotes.push({ ...note, line: note.line + lines });
    for (const link of part.links) into.links.push({ ...link, startLine: link.startLine + lines, endLine: link.endLine + lines });
}

/**
 * The footnote facts of the whole note `text` (its lines `lines`, joined
 * with "\n"), read part by part, exactly as one parse of the whole note
 * would read them.
 *
 * Why a part reads as the whole note does. The parser reads the note's top
 * level one block at a time, starting each block afresh, and where a block
 * ends is decided by the lines it holds and the line after it. (A few
 * readers look one line further: a table needs its second line, and a
 * "$$" line opens math only with a line after it. Cut off there, they
 * decline, which can only stop a part from ending, never end it wrongly.)
 * So a part is parsed together with the first line of the part after it,
 * the borrowed line, and it ends cleanly when the borrowed line starts a
 * block of its own at the top level of that parse. Then the whole note
 * breaks there too: the blocks before the borrowed line read the same
 * with or without the rest of the note, and from that line on the note
 * reads as it would at the start of a note, apart from frontmatter. When
 * the borrowed line does not start a block (a paragraph takes it as a lazy
 * line, a list as its next item, or a code block, a "%%" comment, a "$$"
 * block, or an HTML block is still open over it), the part is tried again
 * with the next part joined to it, then the next two, then four, and so
 * on, until it ends cleanly or reaches the end of the note. Doubling keeps
 * a long open block (a fence typed near the top of a long note) to about
 * two parses of what it covers, instead of one per part. Frontmatter is
 * the one block whose start depends on a line far below it (its closing
 * "---"), so no part starts inside it.
 *
 * test/note-reading-parts.test.ts holds this to the whole-note parse, over
 * every saved Obsidian answer and thousands of generated notes, edited
 * at random through the part memory.
 */
function notePartFacts(text: string, lines: readonly string[], reading: number): FootnoteFacts {
    const lineStarts = [0];
    for (const line of lines) lineStarts.push(lineStarts[lineStarts.length - 1] + line.length + 1);
    // the first line after the frontmatter's closing line
    const frontmatter = frontmatterEnd(text);
    const afterFrontmatter = frontmatter === 0 ? 0 : text.slice(0, frontmatter).split("\n").length;
    const starts = partStarts(lines, afterFrontmatter);
    const facts: FootnoteFacts = { definitions: [], references: [], protectedSpans: [], blockSyntax: [], tableRows: [], lineBlocks: [], inlineNotes: [], links: [] };
    let from = 0;
    // the first entry of `starts` after `from`
    let next = 0;
    for (;;) {
        let ended = false;
        for (let joined = 1; next + joined - 1 < starts.length; joined *= 2) {
            const to = starts[next + joined - 1];
            const part = rememberedPart(text, lineStarts, from, to + 1, true, reading);
            if (part !== null) {
                addPart(facts, part, from, lineStarts[from]);
                from = to;
                next += joined;
                ended = true;
                break;
            }
        }
        if (!ended) break;
    }
    // the last part runs to the end of the note and borrows nothing, so it always reads as the note does
    const last = rememberedPart(text, lineStarts, from, lines.length, false, reading);
    if (last !== null) addPart(facts, last, from, lineStarts[from]);
    // forget the parts no recent reading used
    for (const [key, part] of parts) if (part.usedBy <= reading - PartMemory) parts.delete(key);
    return facts;
}

/** A stretch of protected text, as the facts give it. */
type ProtectedSpan = FootnoteFacts["protectedSpans"][number];

/** The definition the reading appends after a note's last line, behind a blank line, to ask whether the note ends inside a region that never closes (openRegionFrom). */
const ProbeLabel = "[^footnote-shortcut-probe]: probe";

/**
 * The part of a protected span the masked twin blots, as offsets. A link's
 * destination keeps its parentheses and an autolink its angle brackets, so
 * the landing walk still recognises a link's tail and steps over it whole
 * (Jason's landing rulings, 2026-09-15); everything else goes whole.
 */
function blotted(text: string, span: ProtectedSpan): [number, number] {
    if (span.kind === "linkDestination" && span.to - span.from >= 2) {
        const open = text[span.from];
        if ((open === "(" && text[span.to - 1] === ")") || (open === "<" && text[span.to - 1] === ">")) return [span.from + 1, span.to - 1];
    }
    return [span.from, span.to];
}

/**
 * Builds the reading from the facts of the note `lines` (as the caller
 * holds them), whose cleaned text (see cleanLine) is `text`.
 */
function readingOf(facts: FootnoteFacts, lines: readonly string[], text: string): NoteReading {
    const lineCount = lines.length;
    // Every caller of the same text gets the same reading, so its lists and
    // definitions are frozen: a caller that tried to change one would
    // change it for everyone, and freezing makes such a slip fail at once
    // instead (spec-document-view-memo-mutation, 2026-09-13).
    const definitions = Object.freeze(
        [...facts.definitions]
            .sort((a, b) => a.start - b.start || a.labelStart - b.labelStart)
            .map((definition) => Object.freeze({ ...definition, container: Object.freeze(definition.container) })),
    );
    const labels = new Array<Definition | null>(lineCount).fill(null);
    for (const definition of definitions) labels[definition.start] ??= definition;
    // which definition owns each line, worked out the first time it is asked
    let owners: (Definition | null)[] | null = null;
    const syntaxEnds = new Map<number, number>();
    for (const { line, end } of facts.blockSyntax) syntaxEnds.set(line, Math.max(syntaxEnds.get(line) ?? 0, end));
    const blockSyntaxEnd = (line: number): number => syntaxEnds.get(line) ?? 0;

    // where each line starts in `text`, and how long it is there (a stray
    // "\r" at the end of a line the caller holds is not in `text`)
    const lineStarts: number[] = [];
    let offset = 0;
    for (let i = 0; i < lineCount; i++) {
        lineStarts.push(offset);
        offset = text.indexOf("\n", offset) + 1;
        if (offset === 0) offset = text.length + 1;
    }
    const lineLength = (line: number): number => (line + 1 < lineCount ? lineStarts[line + 1] - 1 : text.length) - lineStarts[line];

    // The last line a span really reaches. A span may end at the very
    // start of a line, its last character the line break before it (a
    // "%%" comment inside a definition takes the line break with it); it
    // holds nothing of that line then, unless the line is empty and the
    // span ends the note (an unclosed fence's last line, which Obsidian
    // counts as code).
    const lastLineOf = (span: ProtectedSpan): number => {
        const last = Math.min(span.endLine, lineCount - 1);
        return last > span.startLine && span.to === lineStarts[last] && lineLength(last) > 0 ? last - 1 : last;
    };

    // the protected spans that touch each line, a "%%" comment's left out
    // (its text stays live), worked out the first time something asks
    let spansByLine: ProtectedSpan[][] | null = null;
    const spansOn = (line: number): readonly ProtectedSpan[] => {
        if (spansByLine === null) {
            spansByLine = Array.from({ length: lineCount }, () => [] as ProtectedSpan[]);
            for (const span of facts.protectedSpans) {
                if (span.kind === "percentComment") continue;
                for (let l = span.startLine; l <= lastLineOf(span); l++) spansByLine[l].push(span);
            }
        }
        return spansByLine[line] ?? [];
    };

    // Whether `span` covers line `line` through and through. A block covers
    // the line when it starts no later than the line's text (only quote or
    // list markers, indentation, or a byte order mark before it) and runs
    // to the line's end; a stretch of inline text only when it starts on
    // an earlier line and goes on past this one.
    const covers = (span: ProtectedSpan, line: number): boolean => {
        const start = lineStarts[line];
        const end = start + lineLength(line);
        if (!span.block) return span.from < start && span.to > end;
        // a block may stop before spaces or tabs at the end of its last line
        // (a frontmatter closer "---   ")
        if (span.to < end && !/^[ \t]*$/.test(text.slice(span.to, end))) return false;
        if (span.from <= start) return true;
        const before = text.slice(start, span.from);
        return before.length <= Math.min(blockSyntaxEnd(line), lineLength(line)) || /^[ \t\uFEFF]*$/.test(before);
    };
    let protectedLines: readonly boolean[] | null = null;
    const protectedLinesOf = (): readonly boolean[] =>
        (protectedLines ??= Object.freeze(Array.from({ length: lineCount }, (_, line) => spansOn(line).some((span) => covers(span, line)))));

    const masked: (string | undefined)[] = new Array<string | undefined>(lineCount);
    const maskedLine = (line: number): string => {
        if (line < 0 || line >= lineCount) return "";
        const known = masked[line];
        if (known !== undefined) return known;
        const raw = lines[line];
        let result = raw;
        if (protectedLinesOf()[line]) {
            result = "\0".repeat(raw.length);
        } else {
            const start = lineStarts[line];
            const end = start + lineLength(line);
            let chars: string[] | null = null;
            for (const span of spansOn(line)) {
                const [from, to] = blotted(text, span);
                for (let i = Math.max(from, start); i < Math.min(to, end); i++) (chars ??= raw.split(""))[i - start] = "\0";
            }
            if (chars !== null) result = chars.join("");
        }
        masked[line] = result;
        return result;
    };
    let maskedAll: readonly string[] | null = null;

    const comments = Object.freeze(facts.protectedSpans.filter((span) => span.kind === "percentComment"));
    let commentLines: readonly boolean[] | null = null;
    let openRegion: number | null = null;
    let tableRowLines: readonly boolean[] | null = null;
    // every stretch of protected text and "%%" comment touching each line
    let spanKinds: string[][] | null = null;
    // the live references, the labels, and the outermost inline footnotes
    // on each line, in order, worked out the first time something asks
    let referencesByLine: ReferenceOccurrence[][] | null = null;
    const referencesOn = (line: number): readonly ReferenceOccurrence[] => {
        if (referencesByLine === null) {
            referencesByLine = Array.from({ length: lineCount }, () => [] as ReferenceOccurrence[]);
            for (const { name, line: at, start, end, live } of facts.references) {
                if (live && at < lineCount) referencesByLine[at].push({ name, start, end });
            }
            for (const list of referencesByLine) list.sort((a, b) => a.start - b.start);
        }
        return referencesByLine[line] ?? [];
    };
    let labelsByLine: ReferenceOccurrence[][] | null = null;
    let inlineNotesByLine: InlineNoteSpan[][] | null = null;

    return {
        definitions,
        blocks: Object.freeze(definitions.filter((definition) => definition.movable)),
        references: facts.references,
        protectedSpans: facts.protectedSpans,
        links: facts.links,
        labelLines: Object.freeze(labels.map((label) => label !== null)) as boolean[],
        labelOn: (line) => labels[line] ?? null,
        definitionAt(line) {
            if (owners === null) {
                owners = new Array<Definition | null>(lineCount).fill(null);
                // a nested definition starts after the one around it, so it
                // is written later and wins its lines: the innermost owns them
                for (const definition of definitions) {
                    for (let l = definition.start; l <= definition.end; l++) owners[l] = definition;
                }
            }
            return owners[line] ?? null;
        },
        blockSyntaxEnd,
        maskedLine,
        maskedLines: () => (maskedAll ??= Object.freeze(lines.map((_, line) => maskedLine(line)))),
        get protectedLines() {
            return protectedLinesOf();
        },
        get commentLines() {
            if (commentLines === null) {
                const flags = new Array<boolean>(lineCount).fill(false);
                for (const span of comments) {
                    if (!span.block) continue;
                    for (let l = span.startLine; l <= lastLineOf(span); l++) flags[l] = true;
                }
                commentLines = Object.freeze(flags);
            }
            return commentLines;
        },
        comments,
        get tableRowLines() {
            if (tableRowLines === null) {
                const flags = new Array<boolean>(lineCount).fill(false);
                for (const row of facts.tableRows) if (row < lineCount) flags[row] = true;
                tableRowLines = Object.freeze(flags);
            }
            return tableRowLines;
        },
        lineBlocks: Object.freeze(facts.lineBlocks),
        lineSpans(line) {
            if (spanKinds === null) {
                spanKinds = Array.from({ length: lineCount }, () => [] as string[]);
                for (const span of facts.protectedSpans) {
                    for (let l = span.startLine; l <= lastLineOf(span); l++) spanKinds[l].push(l === span.startLine ? `^${span.kind}` : span.kind);
                }
            }
            return spanKinds[line] ?? [];
        },
        lineReferences: (line) => referencesOn(line).map((reference) => reference.name.toLowerCase()),
        referencesOn,
        referenceAt: (line, ch) => referencesOn(line).find((reference) => ch > reference.start && ch < reference.end) ?? null,
        labelsOn(line) {
            if (labelsByLine === null) {
                labelsByLine = Array.from({ length: lineCount }, () => [] as ReferenceOccurrence[]);
                // the label's "[^name]" runs from its "[" to just before its ":"
                for (const { name, start, labelStart, labelEnd } of definitions) labelsByLine[start].push({ name, start: labelStart, end: labelEnd - 1 });
            }
            return labelsByLine[line] ?? [];
        },
        inlineNotesOn(line) {
            if (inlineNotesByLine === null) {
                inlineNotesByLine = Array.from({ length: lineCount }, () => [] as InlineNoteSpan[]);
                const sorted = [...facts.inlineNotes].sort((a, b) => a.line - b.line || a.open - b.open);
                for (const { line: at, open, close } of sorted) {
                    const list = inlineNotesByLine[at] as InlineNoteSpan[] | undefined;
                    if (list === undefined) continue;
                    // one inside the last one kept is held by it
                    const last = list.at(-1);
                    if (last !== undefined && open < last.close) continue;
                    list.push({ open, close });
                }
            }
            return inlineNotesByLine[line] ?? [];
        },
        inlineNoteAt(line, ch) {
            let found: { open: number; close: number } | null = null;
            for (const note of facts.inlineNotes) {
                if (note.line !== line || ch <= note.open || ch > note.close) continue;
                if (found === null || note.open > found.open) found = { open: note.open, close: note.close };
            }
            return found;
        },
        insideLink: (line, ch) =>
            facts.links.some(
                (link) =>
                    (line > link.startLine || (line === link.startLine && ch >= link.start)) &&
                    (line < link.endLine || (line === link.endLine && ch < link.end)),
            ),
        regionOpenAt(line) {
            if (line < 0 || line >= lineCount) return false;
            const start = lineStarts[line];
            return spansOn(line).some((span) => span.from < start && span.to > start);
        },
        get openRegionFrom() {
            if (openRegion === null) {
                // the note with a definition written after a blank line under
                // its last line: unless a region still open swallows it, the
                // definition is one
                const probeLine = lineCount + 1;
                const probe = readNote([...lines, "", ProbeLabel]);
                if (probe.labelOn(probeLine) !== null) {
                    openRegion = -1;
                } else {
                    // The region is the block that took the probe in, at
                    // the top level of the note: it starts on the nearest
                    // line above where that kind of block is marked as
                    // starting (lineBlocks). A protected stretch did not
                    // always say: a link definition's open label, "[" alone
                    // on a line, swallows the probe with no protected text
                    // around it, and the region was then taken to start on
                    // the note's last line, below the "[", so the press put
                    // its definition where the label swallowed it too and
                    // was refused (hunt 2026-10-05, pin
                    // bug-open-label-line-refuses-press; Obsidian's answer
                    // swap34:lrd-label-blank-para).
                    const outermost = (line: number): string => (probe.lineBlocks[line] ?? "").split(" ")[0];
                    const start = `^${outermost(probeLine).replace(/^\^/, "")}`;
                    let from = probeLine;
                    while (from > 0 && outermost(from) !== start) from--;
                    openRegion = Math.min(from, Math.max(0, lineCount - 1));
                }
            }
            return openRegion;
        },
    };
}

/** The note reading of `lines`, built once per distinct text and then remembered. */
export function readNote(lines: readonly string[]): NoteReading {
    // Remembered by the text exactly as the caller holds it, since the
    // masked twin keeps every character of it, a stray "\r" included, and
    // by the number of lines, since no lines and one empty line join to
    // the same text.
    const key = `${lines.length}:${lines.join("\n")}`;
    const known = cache.get(key);
    if (known) {
        // move it to the most recently used end
        cache.delete(key);
        cache.set(key, known);
        return known;
    }
    let clean = lines;
    let text = lines.join("\n");
    if (text.includes("\r")) {
        clean = lines.map(cleanLine);
        text = clean.join("\n");
    }
    readings++;
    const reading = readingOf(notePartFacts(text, clean, readings), [...lines], text);
    cache.set(key, reading);
    if (cache.size > CacheSize) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    return reading;
}
