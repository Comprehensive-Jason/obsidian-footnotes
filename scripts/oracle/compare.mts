// Turns two readings of one note into a list of disagreements in plain
// terms: Obsidian's (from inapp-parse.js in the live app, or from the
// answers saved under test/obsidian-answers/) and a reader's (the plugin's
// scanner through plugin-facts.ts, or the remark-parse 8 reader through
// reader-facts.ts). Lines are 0-based, as both sides report them.
//
// This one file is the comparison rule for the live oracle (run-oracle.mjs)
// and for the offline referee suite (test/obsidian-referee.test.ts), so the
// two can never judge differently. It is TypeScript that Node runs directly
// (Node 22.18 or later strips the types), so it uses only syntax that
// type stripping allows and imports nothing.

/** Obsidian's parse of one note, as inapp-parse.js returns it. Each entry is [type or id, start line, ...]. */
interface ObsidianParse {
    sections: [string, number, number][];
    /** [id, start line, start column, end line, end column] */
    footnotes: [string, number, number, number, number][];
    refs: [string, number, number, number, number][];
}

/** One note's entry from inapp-parse.js: the note's own parse, plus the appendix and prefix probes when it has undefined names. */
export interface ObsidianEntry {
    first: ObsidianParse;
    appendix?: { names: string[]; firstLine: number; step: number };
    second?: ObsidianParse;
    prefix?: { names: string[]; shift: number };
    third?: ObsidianParse;
}

interface ObsidianDefinition {
    name: string;
    line: number;
    column: number;
    /** The last line of the definition. */
    end: number;
}

export interface NamedPlace {
    name: string;
    line: number;
    column: number;
}

/** What Obsidian says about a note, in the form the comparison needs. */
export interface ObsidianFacts {
    definitions: ObsidianDefinition[];
    /** Live references, the defined and the undefined alike. */
    references: NamedPlace[];
    /** Reference names (lower case) whose liveness could not be asked about. */
    unknown: string[];
    /** Top-level code sections, as [first line, last line]. */
    codeSections: [number, number][];
}

/** One definition as a reader reads it. `end` is null where the reader does not model the extent. */
interface ReaderDefinition {
    name: string;
    kind: string;
    line: number;
    end: number | null;
}

/** A reader's reading of a note: its definitions, its live references, and per line the kind of protected text or "". */
export interface ReaderFacts {
    definitions: ReaderDefinition[];
    references: NamedPlace[];
    lineKinds: string[];
}

export interface Disagreement {
    kind: "def-only-obsidian" | "def-only-plugin" | "def-end" | "ref-only-obsidian" | "ref-only-plugin" | "code-unprotected";
    name: string;
    line: number;
    detail: string;
}

/**
 * One note with Obsidian's answers, packed small for the saved corpus under
 * test/obsidian-answers/: definitions as [name, line, column, last line],
 * references as [name, line, column], code sections as [first, last].
 */
export interface SavedAnswer {
    id: string;
    text: string;
    defs: [string, number, number, number][];
    refs: [string, number, number][];
    code: [number, number][];
    unknown?: string[];
}

const IGNORED_SECTIONS = new Set(["text", "element"]);

const fold = (name: string): string => name.toLowerCase();

// An inline footnote "^[text]" shows up in Obsidian's footnotes list with
// a made-up id such as "[inline0" (with no closing bracket, as Obsidian
// 1.14.4 writes it); it is not a definition the scanner reads.
export const isInlineId = (id: string): boolean => /^\[inline\d+\]?$/.test(id);

function withoutInline(parse: ObsidianParse): ObsidianParse {
    return { ...parse, footnotes: parse.footnotes.filter((f) => !isInlineId(f[0])), refs: parse.refs.filter((r) => !isInlineId(r[0])) };
}

/** The last line a position really covers: an end at column 0 of a later line stops on the line before. */
function lastLine(startLine: number, endLine: number, endCol: number): number {
    return endCol === 0 && endLine > startLine ? endLine - 1 : endLine;
}

/**
 * A reader's block end without trailing blank lines. Inside an unclosed
 * fence or comment the block runs to the note's last line, which is often
 * the empty line after the final newline, while Obsidian's extent stops at
 * the last line holding text.
 */
export function trimmedEnd(note: string, start: number, end: number): number {
    const lines = note.split("\n");
    let e = end;
    while (e > start && (lines[e] ?? "").trim() === "") e--;
    return e;
}

function sectionsKey(parse: ObsidianParse, from: number, to: number, shift: number): string {
    return JSON.stringify(parse.sections.filter((s) => !IGNORED_SECTIONS.has(s[0]) && s[1] >= from && s[1] < to).map((s) => [s[0], s[1] - shift, s[2] - shift]));
}

function footnotesKey(parse: ObsidianParse, from: number, to: number, shift: number): string {
    return JSON.stringify(parse.footnotes.filter((f) => f[1] >= from && f[1] < to).map((f) => [fold(f[0]), f[1] - shift, f[2], f[3] - shift]));
}

const place = (r: [string, number, number, number, number], shift = 0): NamedPlace => ({ name: r[0], line: r[1] - shift, column: r[2] });

/**
 * Obsidian's live references, the defined and the undefined alike, with the
 * names that could not be read at all. See inapp-parse.js for the appendix
 * and prefix parses.
 */
function obsidianReferences(note: string, raw: ObsidianEntry): { refs: NamedPlace[]; unknownNames: string[] } {
    const first = withoutInline(raw.first);
    const lineCount = note.split("\n").length - (note.endsWith("\n") ? 1 : 0);
    const refs = first.refs.map((r) => place(r));
    if (!raw.appendix || !raw.second) return { refs, unknownNames: [] };
    const wanted = raw.appendix.names.map(fold);
    const firstKey = sectionsKey(first, 0, lineCount, 0) + footnotesKey(first, 0, lineCount, 0);
    // the appendix reading counts when the note above it parsed the same and
    // every appended definition was read as a definition
    const second = withoutInline(raw.second);
    const appendixLine = raw.appendix.firstLine;
    const appendedOk = wanted.every((n) => second.footnotes.some((f) => fold(f[0]) === n && f[1] >= appendixLine)) && sectionsKey(second, 0, lineCount, 0) + footnotesKey(second, 0, lineCount, 0) === firstKey;
    if (appendedOk) return { refs: second.refs.filter((r) => r[1] < lineCount).map((r) => place(r)), unknownNames: [] };
    if (raw.third && raw.prefix) {
        const shift = raw.prefix.shift;
        const third = withoutInline(raw.third);
        const prefixOk = wanted.every((n) => third.footnotes.some((f) => fold(f[0]) === n && f[1] < shift)) && sectionsKey(third, shift, shift + lineCount, shift) + footnotesKey(third, shift, shift + lineCount, shift) === firstKey;
        if (prefixOk) return { refs: third.refs.filter((r) => r[1] >= shift).map((r) => place(r, shift)), unknownNames: [] };
    }
    return { refs, unknownNames: wanted };
}

/** Obsidian's facts from its own parse of the note and its live references (already resolved). */
function obsidianFactsFromParse(first: ObsidianParse, references: NamedPlace[], unknown: string[]): ObsidianFacts {
    return {
        definitions: withoutInline(first).footnotes.map((f) => ({ name: f[0], line: f[1], column: f[2], end: lastLine(f[1], f[3], f[4]) })),
        references: references.filter((r) => !isInlineId(r.name)),
        unknown,
        codeSections: first.sections.filter((s) => s[0] === "code").map((s) => [s[1], s[2]]),
    };
}

/** Obsidian's facts from a live inapp-parse.js entry, its references resolved through the appendix or prefix probe. */
export function obsidianFacts(note: string, entry: ObsidianEntry): ObsidianFacts {
    const { refs, unknownNames } = obsidianReferences(note, entry);
    return obsidianFactsFromParse(entry.first, refs, unknownNames);
}

/** Packs a note and Obsidian's facts about it for the saved corpus. */
export function packAnswer(id: string, text: string, facts: ObsidianFacts): SavedAnswer {
    return {
        id,
        text,
        defs: facts.definitions.map((d) => [d.name, d.line, d.column, d.end]),
        refs: facts.references.map((r) => [r.name, r.line, r.column]),
        code: facts.codeSections,
        ...(facts.unknown.length > 0 ? { unknown: facts.unknown } : {}),
    };
}

/** Obsidian's facts from a saved answer. */
export function unpackAnswer(answer: SavedAnswer): ObsidianFacts {
    return {
        definitions: answer.defs.map(([name, line, column, end]) => ({ name, line, column, end })),
        references: answer.refs.map(([name, line, column]) => ({ name, line, column })),
        unknown: answer.unknown ?? [],
        codeSections: answer.code,
    };
}

/**
 * The disagreements between Obsidian's facts and a reader's facts about
 * `note`. `reader` names the reader in the details ("the plugin" by
 * default). Kinds:
 *   def-only-obsidian   Obsidian reads a definition here, the reader does not
 *   def-only-plugin     the reader reads a definition here, Obsidian does not
 *   def-end             both read the definition, its last line differs
 *   ref-only-obsidian   a live reference to Obsidian, dead or absent to the reader
 *   ref-only-plugin     a live reference to the reader, dead text to Obsidian
 *   code-unprotected    a line of a top-level Obsidian code block the reader leaves unprotected
 * A live reference to the reader whose name Obsidian could not be asked about is not counted.
 */
export function compareFacts(note: string, obsidian: ObsidianFacts, facts: ReaderFacts, reader = "the plugin"): Disagreement[] {
    const out: Disagreement[] = [];
    const used = new Set<number>();
    for (const d of obsidian.definitions) {
        const i = facts.definitions.findIndex((p, k) => !used.has(k) && p.line === d.line && fold(p.name) === fold(d.name));
        if (i === -1) {
            out.push({ kind: "def-only-obsidian", name: d.name, line: d.line, detail: `Obsidian reads a definition of [^${d.name}] on line ${d.line + 1} (lines ${d.line + 1}-${d.end + 1}); ${reader} does not` });
            continue;
        }
        used.add(i);
        const p = facts.definitions[i];
        if (p.end !== null && trimmedEnd(note, p.line, p.end) !== d.end) {
            out.push({ kind: "def-end", name: d.name, line: d.line, detail: `[^${d.name}] on line ${d.line + 1} ends on line ${d.end + 1} to Obsidian, line ${trimmedEnd(note, p.line, p.end) + 1} to ${reader} (${p.kind})` });
        }
    }
    facts.definitions.forEach((p, k) => {
        if (!used.has(k)) out.push({ kind: "def-only-plugin", name: p.name, line: p.line, detail: `${reader} reads ${p.kind === "in-item" ? "an" : "a"} ${p.kind} definition of [^${p.name}] on line ${p.line + 1}; Obsidian does not` });
    });

    const unknown = new Set(obsidian.unknown);
    const key = (r: NamedPlace) => `${r.line}:${r.column}`;
    // An empty inline footnote "^[]" shows up among the metadata cache's
    // references with an empty name (and not among its inline notes), but
    // Reading view renders nothing there, so it is no reference: it is left
    // out here, for the live oracle and the saved answers alike (the
    // overnight oracle run, 2026-10-03: 1,300 of 20,000 notes, and 7 probes).
    const obsKeys = new Map(obsidian.references.filter((r) => r.name !== "").map((r) => [key(r), r]));
    const readerKeys = new Map(facts.references.map((r) => [key(r), r]));
    for (const [k, r] of obsKeys) {
        if (!readerKeys.has(k)) out.push({ kind: "ref-only-obsidian", name: r.name, line: r.line, detail: `Obsidian reads a live reference [^${r.name}] at line ${r.line + 1}, column ${r.column + 1}; ${reader} does not` });
    }
    for (const [k, r] of readerKeys) {
        if (obsKeys.has(k) || unknown.has(fold(r.name))) continue;
        out.push({ kind: "ref-only-plugin", name: r.name, line: r.line, detail: `${reader} reads a live reference [^${r.name}] at line ${r.line + 1}, column ${r.column + 1}; to Obsidian it is dead text` });
    }

    for (const [from, to] of obsidian.codeSections) {
        for (let line = from; line <= to; line++) {
            if (facts.lineKinds[line] === "") out.push({ kind: "code-unprotected", name: "", line, detail: `line ${line + 1} is in a code block to Obsidian; ${reader} leaves it unprotected` });
        }
    }
    return out;
}

/**
 * The live oracle's comparison of one note: the disagreements, the names
 * whose liveness is unknown, and Obsidian's live references as
 * {name, line, column}.
 */
export function compareNote(note: string, entry: ObsidianEntry, facts: ReaderFacts, reader?: string): { disagreements: Disagreement[]; unknown: string[]; obsidianRefs: NamedPlace[] } {
    const obsidian = obsidianFacts(note, entry);
    return { disagreements: compareFacts(note, obsidian, facts, reader), unknown: obsidian.unknown, obsidianRefs: obsidian.references };
}
