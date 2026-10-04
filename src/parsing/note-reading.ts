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
// The plugin still finds protected text and reference liveness with the
// hand-written scanner (markdown-scan.ts); those move onto this reading in
// a later step of the swap (Jason, 2026-10-03).

import { DefinitionFact, FootnoteFacts, partFacts } from "./footnote-facts";
import { frontmatterEnd } from "./obsidian-markdown";

/** A definition as the reading gives it: name, label line and columns, last line, container. */
export type Definition = DefinitionFact;

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
     * break, a setext underline, a heading with no text.
     */
    blockSyntaxEnd(line: number): number;
}

/** How many notes the reading remembers. A press reads the note as it is and as it will be after the edit, and a lint passes each rule's output to the next, so a handful covers both. */
const CacheSize = 4;

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

/** How many readings back a remembered part may last have been used before it is forgotten: the parts of the last four readings stay. */
const PartMemory = 4;

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
    const facts: FootnoteFacts = { definitions: [], references: [], protectedSpans: [], blockSyntax: [] };
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

/** Builds the reading from the facts of a note with `lineCount` lines. */
function readingOf(facts: FootnoteFacts, lineCount: number): NoteReading {
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
    return {
        definitions,
        blocks: Object.freeze(definitions.filter((definition) => definition.movable)),
        references: facts.references,
        protectedSpans: facts.protectedSpans,
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
        blockSyntaxEnd: (line) => syntaxEnds.get(line) ?? 0,
    };
}

/** The note reading of `lines`, built once per distinct text and then remembered. */
export function readNote(lines: readonly string[]): NoteReading {
    let clean = lines;
    let text = lines.join("\n");
    if (text.includes("\r")) {
        clean = lines.map(cleanLine);
        text = clean.join("\n");
    }
    const known = cache.get(text);
    if (known) {
        // move it to the most recently used end
        cache.delete(text);
        cache.set(text, known);
        return known;
    }
    readings++;
    const reading = readingOf(notePartFacts(text, clean, readings), lines.length);
    cache.set(text, reading);
    if (cache.size > CacheSize) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    return reading;
}
