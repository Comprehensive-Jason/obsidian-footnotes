import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { SavedAnswer } from "../scripts/oracle/compare.mjs";
import { generateBroadNotes, generateNotes } from "../scripts/oracle/generate.mjs";
import { footnoteFacts } from "../src/parsing/footnote-facts";
import { partParseCounts, readNote } from "../src/parsing/note-reading";

// The note reading parses a note in parts and remembers each part by its
// text, so that a read after an edit parses only the part the edit changed
// (src/parsing/note-reading.ts, the speed brief, 2026-10-03). These tests
// hold it to the one thing that matters: its definitions, references, and
// protected text are exactly those of one parse of the whole note, on every
// saved Obsidian answer and on thousands of generated notes, and they stay
// so while the notes are edited at random, every read going through the
// part memory as a press or a lint would.

/** A small fast seeded random source (mulberry32, as in the oracle's generator); returns floats in [0, 1). */
function random(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Whole lines an edit may put in: the openers and closers of every block that runs on until it is closed, and the lines around them. */
const EditLines = [
    "",
    "",
    "```",
    "~~~",
    "%%",
    "%% note",
    "$$",
    "<!--",
    "-->",
    "<div>",
    "<pre>",
    "</pre>",
    "---",
    "===",
    "[^1]: x",
    "[^a]: a definition",
    "    continued",
    "    [^n]: nested",
    "\t[^t]: after a tab",
    "- item",
    "1. item",
    "  - nested item",
    "> quote",
    "> [!note] title",
    "| a | b |",
    "| --- | --- |",
    "# heading",
    "text[^1] more",
    "%% a %%",
    "$$ x $$",
];

/** Pieces of text an edit may put inside a line; "\n" splits the line. */
const EditPieces = ["`", "```", "%", "%%", "$", "$$", "<", "<!--", "-->", "!", "-", "---", ">", "[", "]", "^", "[^", "]:", "[^1]", "^[", ":", " ", "    ", "\t", "|", "=", "*", "1. ", "x", "\n", "\n\n"];

/** One random edit of `lines`: a line put in, taken out, or replaced, a piece of text put in or taken out, or two lines joined. */
function edit(lines: string[], r: () => number): string[] {
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    const at = Math.floor(r() * lines.length);
    const next = [...lines];
    switch (Math.floor(r() * 6)) {
        case 0:
            next.splice(Math.floor(r() * (lines.length + 1)), 0, pick(EditLines));
            return next;
        case 1:
            if (next.length > 1) next.splice(at, 1);
            return next;
        case 2:
            next[at] = pick(EditLines);
            return next;
        case 3: {
            const column = Math.floor(r() * (next[at].length + 1));
            const changed = next[at].slice(0, column) + pick(EditPieces) + next[at].slice(column);
            next.splice(at, 1, ...changed.split("\n"));
            return next;
        }
        case 4: {
            const column = Math.floor(r() * next[at].length);
            next[at] = next[at].slice(0, column) + next[at].slice(column + 1 + Math.floor(r() * 3));
            return next;
        }
        default:
            if (at + 1 < next.length) next.splice(at, 2, next[at] + next[at + 1]);
            return next;
    }
}

/** The difference between the note reading of `lines` and one parse of the whole note, or null when there is none. */
function difference(lines: string[]): string | null {
    const whole = footnoteFacts(lines.join("\n"));
    const reading = readNote(lines);
    const definitions = [...whole.definitions].sort((a, b) => a.start - b.start || a.labelStart - b.labelStart);
    // where each line's block syntax ends, line by line (the press's block-syntax guard)
    const syntaxEnds = lines.map(() => 0);
    for (const { line, end } of whole.blockSyntax) syntaxEnds[line] = Math.max(syntaxEnds[line], end);
    for (const [what, read, expected] of [
        ["definitions", reading.definitions, definitions],
        ["references", reading.references, whole.references],
        ["protected text", reading.protectedSpans, whole.protectedSpans],
        ["block syntax", lines.map((_, line) => reading.blockSyntaxEnd(line)), syntaxEnds],
    ] as const) {
        const got = JSON.stringify(read);
        const want = JSON.stringify(expected);
        if (got !== want) return `${what}: read in parts ${got}, whole ${want}`;
    }
    return null;
}

/**
 * Reads each note, then edits it at random `edits` times, reading it after
 * every edit, and returns the first few notes on which the reading in parts
 * and the whole-note parse differ, with the edit that showed it.
 */
function differences(notes: readonly string[], edits: number, seed: number): string[] {
    const r = random(seed);
    const found: string[] = [];
    for (const note of notes) {
        let lines = note.split("\n");
        for (let e = 0; e <= edits && found.length < 5; e++) {
            if (e > 0) lines = edit(lines, r);
            const problem = difference(lines);
            if (problem !== null) found.push(`${JSON.stringify(lines.join("\n"))}\n    ${problem}`);
        }
    }
    return found;
}

/** Notes made by joining one to five of `notes`, with a blank line, a line break, or nothing between, so that a note's open block can run into the next. */
function joined(notes: readonly string[], seed: number): string[] {
    const r = random(seed);
    const out: string[] = [];
    for (let i = 0; i < notes.length; ) {
        const count = 1 + Math.floor(r() * 5);
        let text = notes[i];
        for (let k = 1; k < count && i + k < notes.length; k++) text += ["\n\n", "\n", ""][Math.floor(r() * 3)] + notes[i + k];
        out.push(text);
        i += count;
    }
    return out;
}

/**
 * How many random edits each note gets: two for a saved answer, three for a
 * joined generated note. A soak multiplies them, as it multiplies the
 * property tests' runs (TESTING.md: FC_NUM_RUNS=5000 gives 25 times as many).
 */
const Soak = Number(process.env.FC_NUM_RUNS ?? 200) / 200;
const AnswerEdits = Math.round(2 * Soak);
const GeneratedEdits = Math.round(3 * Soak);

const AnswerFiles = ["fuzz-20261003", "reproducers", "recorded-facts", "pins", "probes", "broad-20261004", "overnight-probes"];

describe("the note reading in parts reads every note as one parse of the whole note does", () => {
    for (const file of AnswerFiles) {
        it(`Obsidian's saved answers: ${file}, then edited at random`, () => {
            const answers = JSON.parse(readFileSync(new URL(`./obsidian-answers/${file}.json`, import.meta.url), "utf8")) as SavedAnswer[];
            expect(differences(answers.map((answer) => answer.text), AnswerEdits, 20261003)).toEqual([]);
        }, 120000 * Soak);
    }

    it("generated notes, joined into longer ones, then edited at random", () => {
        const notes = joined([...generateNotes(20261010, 1500), ...generateBroadNotes(20261011, 1500)], 20261012);
        expect(differences(notes, GeneratedEdits, 20261013)).toEqual([]);
    }, 120000 * Soak);

    it("tries a longer part when a part does not end cleanly, which the notes above do often", () => {
        const before = partParseCounts();
        // a fence open over a blank line, then a lazy label under prose
        const reading = readNote(["```", "code", "", "more code", "```", "", "prose", "[^1]: lazy", "", "after[^1]"]);
        expect(reading.definitions).toEqual([]);
        expect(reading.protectedSpans.map((span) => [span.kind, span.startLine, span.endLine])).toEqual([["code", 0, 4]]);
        expect(partParseCounts().unclean).toBeGreaterThan(before.unclean);
    });
});

describe("the part memory", () => {
    /** A note of `count` paragraphs, each two lines with a reference, then their definitions one under another. */
    function note(count: number, tag: string): string[] {
        const lines: string[] = [];
        for (let i = 1; i <= count; i++) lines.push(`Paragraph ${i} of the ${tag} note[^${i}].`, "It goes on a little.", "");
        for (let i = 1; i <= count; i++) lines.push(`[^${i}]: Definition ${i}.`);
        return lines;
    }

    it("parses a long note in many parts, and after an edit only the part the edit falls in", () => {
        const lines = note(200, "part memory");
        let before = partParseCounts().parsed;
        readNote(lines);
        expect(partParseCounts().parsed - before).toBeGreaterThan(20);
        // the second line of the hundredth paragraph, which no part starts with or borrows
        const edited = [...lines];
        edited[298] = "It goes on a little longer.";
        before = partParseCounts().parsed;
        readNote(edited);
        expect(partParseCounts().parsed - before).toBe(1);
    });

    it("parses a new definition among the others with at most the part above it, whose borrowed line may have changed", () => {
        const lines = note(200, "definition");
        readNote(lines);
        const before = partParseCounts().parsed;
        const edited = [...lines];
        edited.splice(700, 0, "[^new]: A new definition.");
        const reading = readNote(edited);
        expect(reading.labelOn(700)?.name).toBe("new");
        expect(partParseCounts().parsed - before).toBeLessThanOrEqual(2);
    });

    it("never starts a part inside the frontmatter, whose closing line decides what its first line is", () => {
        const lines = ["---", "a: 1", "", "b: [^1]", "---", "", "text[^1]", "", "[^1]: d"];
        expect(readNote(lines).protectedSpans.map((span) => [span.kind, span.startLine, span.endLine])).toEqual([["frontmatter", 0, 4]]);
        expect(readNote(lines).references.map((reference) => reference.line)).toEqual([6]);
    });

    it("never starts a part at a line that starts with a byte order mark, which the parser drops only at the start of the note", () => {
        const bom = String.fromCharCode(0xfeff);
        // in the middle of a note the mark is a character, so the label after it is no label
        for (let i = 0; i < 40; i++) {
            const lines = [`paragraph ${i}`, "", `${bom}[^${i}]: not a definition`, "", `after[^${i}]`];
            expect(readNote(lines).definitions).toEqual([]);
        }
    });
});
