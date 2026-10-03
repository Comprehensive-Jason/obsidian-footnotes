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
// Jason's ruling 1, option a (2026-10-03): a definition is a definition
// wherever it sits, at the top level, in a quote or callout, in a list
// item, or inside another footnote. Each one carries its container, and
// only a "movable" one is ever moved (see DefinitionFact in
// footnote-facts.ts).
//
// The plugin still finds protected text and reference liveness with the
// hand-written scanner (markdown-scan.ts); those move onto this reading in
// a later step of the swap (Jason, 2026-10-03).

import { DefinitionFact, FootnoteFacts, footnoteFacts } from "./footnote-facts";

/** A definition as the reading gives it: name, label line and columns, last line, container. */
type Definition = DefinitionFact;

/** One note, read once. */
export interface NoteReading {
    /** Every definition in the note, wherever it sits, in the order of their labels. */
    readonly definitions: readonly Definition[];
    /** Every reference, with whether it is live. */
    readonly references: FootnoteFacts["references"];
    /** One entry per line: true where the label of some definition sits on the line. */
    readonly labelLines: readonly boolean[];
    /** The definition whose label sits on `line` (the first, when one line holds two), or null. */
    labelOn(line: number): Definition | null;
    /** The innermost definition whose lines, label line to last line, take in `line`, or null. */
    definitionAt(line: number): Definition | null;
}

/** How many notes the reading remembers. A press reads the note as it is and as it will be after the edit, and a lint passes each rule's output to the next, so a handful covers both. */
const CacheSize = 4;

/** The remembered readings, the most recently used last. A Map keeps its keys in the order they were added. */
const cache = new Map<string, NoteReading>();

/** How many times a note has been parsed since the plugin loaded, for the tests that check the cache. */
let parses = 0;

/** How many full parses the reading has made so far. */
export function parseCount(): number {
    return parses;
}

/**
 * The note's text as the parser should see it: the lines joined with "\n".
 * A line may end in a stray "\r" when a caller split Windows text on "\n"
 * alone; it is dropped, as the scanner drops it. A "\r" anywhere else would
 * read as a line break of its own and shift every line after it, so it
 * becomes a space, which keeps every column where it was.
 */
function textOf(lines: readonly string[]): string {
    const text = lines.join("\n");
    if (!text.includes("\r")) return text;
    return text.replace(/\r(?=\n|$)/g, "").replace(/\r/g, " ");
}

/** Builds the reading from the facts of a note with `lineCount` lines. */
function readingOf(facts: FootnoteFacts, lineCount: number): NoteReading {
    const definitions = [...facts.definitions].sort((a, b) => a.start - b.start || a.labelStart - b.labelStart);
    const labels = new Array<Definition | null>(lineCount).fill(null);
    for (const definition of definitions) labels[definition.start] ??= definition;
    // which definition owns each line, worked out the first time it is asked
    let owners: (Definition | null)[] | null = null;
    return {
        definitions,
        references: facts.references,
        labelLines: labels.map((label) => label !== null),
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
    };
}

/** The note reading of `lines`, parsed once per distinct text and then remembered. */
export function readNote(lines: readonly string[]): NoteReading {
    const text = textOf(lines);
    const known = cache.get(text);
    if (known) {
        // move it to the most recently used end
        cache.delete(text);
        cache.set(text, known);
        return known;
    }
    parses++;
    const reading = readingOf(footnoteFacts(text), lines.length);
    cache.set(text, reading);
    if (cache.size > CacheSize) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    return reading;
}
