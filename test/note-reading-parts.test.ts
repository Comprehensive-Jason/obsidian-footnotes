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
    'an <a id="q"> open tag',
    'a <a id="q"/> closed-looking tag',
    "</a>",
    "a closer </a> here",
    "a [link](u) and http://u.example",
];

/** Pieces of text an edit may put inside a line; "\n" splits the line. */
const EditPieces = ["`", "```", "%", "%%", "$", "$$", "<", "<!--", "-->", "!", "-", "---", ">", "[", "]", "^", "[^", "]:", "[^1]", "^[", ":", " ", "    ", "\t", "|", "=", "*", "1. ", "x", "\n", "\n\n", '<a id="q">', "<a ", "</a>"];

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
    // the whole note as the reading sees it: a "\r" at the end of a line
    // dropped and one inside a line read as a space (cleanLine in
    // note-reading.ts), so the two count the same lines
    const whole = footnoteFacts(lines.map((line) => line.replace(/\r$/, "").replace(/\r/g, " ")).join("\n"));
    const reading = readNote(lines);
    const definitions = [...whole.definitions].sort((a, b) => a.start - b.start || a.labelStart - b.labelStart);
    // where each line's block syntax ends, line by line (the press's block-syntax guard)
    const syntaxEnds = lines.map(() => 0);
    for (const { line, end } of whole.blockSyntax) syntaxEnds[line] = Math.max(syntaxEnds[line], end);
    for (const [what, read, expected] of [
        ["definitions", reading.definitions, definitions],
        ["references", reading.references, whole.references],
        ["protected text", reading.protectedSpans, whole.protectedSpans],
        ["links", reading.links, whole.links],
        ["link labels", [...reading.linkLabels], [...new Set(whole.linkDefinitions.map((definition) => definition.label))]],
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

/** FC_SEED shifts every seed below, so a soak can run on other notes and other edits than the everyday run's. */
const Seed = Number(process.env.FC_SEED ?? 0);
const AnswerEdits = Math.round(2 * Soak);
const GeneratedEdits = Math.round(3 * Soak);

const AnswerFiles = ["fuzz-20261003", "reproducers", "recorded-facts", "pins", "probes", "broad-20261004", "overnight-probes", "swap34-probes"];

describe("the note reading in parts reads every note as one parse of the whole note does", () => {
    for (const file of AnswerFiles) {
        it(`Obsidian's saved answers: ${file}, then edited at random`, () => {
            const answers = JSON.parse(readFileSync(new URL(`./obsidian-answers/${file}.json`, import.meta.url), "utf8")) as SavedAnswer[];
            expect(differences(answers.map((answer) => answer.text), AnswerEdits, 20261003 + Seed)).toEqual([]);
        }, 120000 * Soak);
    }

    it("generated notes, joined into longer ones, then edited at random", () => {
        const notes = joined([...generateNotes(20261010 + Seed, 1500), ...generateBroadNotes(20261011 + Seed, 1500)], 20261012 + Seed);
        expect(differences(notes, GeneratedEdits, 20261013 + Seed)).toEqual([]);
    }, 120000 * Soak);

    // A link definition's label runs to the first "]" wherever it is, over
    // blank lines too: remark-parse 8 reads "[" alone on a line, then a
    // paragraph, then "[^1]: def" as one link definition, and so does
    // Obsidian (live answers swap34:lrd-label-blank-para and
    // swap34:lrd-label-parts-repro, 2026-10-03; Reading view shows no
    // footnote). Cut off at a part's end, the label found no "]" and the
    // part read a paragraph and a footnote instead. The first note is the
    // one the parts test found at FC_NUM_RUNS=3000 (the runtime swap, step
    // 2); the others run the label over enough paragraphs that some part
    // starts inside it whatever the part starts are.
    it("reads a link definition whose label runs over blank lines as the whole note does", () => {
        const notes = [
            "[\n  - nested item\n\n\n$$\nText\n$$1.       [^1]: def\n",
            ["[", "", ...Array.from({ length: 60 }, (_, i) => [`Paragraph ${i} of the open label.`, ""]).flat(), "[^1]: def", "", "x[^1]"].join("\n"),
            ["[a", "", ...Array.from({ length: 60 }, (_, i) => [`Line ${i} in the label`, ""]).flat(), "b]:", "", "", "http://u", "", "x[^1]", "", "[^1]: d"].join("\n"),
        ];
        expect(notes.map((note) => difference(note.split("\n")))).toEqual(notes.map(() => null));
    });

    // The same for a definition's title and for an address in angle
    // brackets: a title may start after blank lines and run over lines, and
    // "<...>" may hold blank lines, so a part may start inside either (hunt
    // 2026-10-05, pin bug-parts-link-definition-title). Each of the 60
    // title openers below is one more line some part may start at, and the
    // address runs over 60 paragraphs.
    it("reads a link definition whose title or address a part may start inside as the whole note does", () => {
        const notes = [
            ...Array.from({ length: 60 }, (_, i) => ["[foo]: /url", "", `${["'", '"', "("][i % 3]}title ${i} [^1] w`, `le${["'", '"', ")"][i % 3]}`, "", "use[^1]", "", "[^1]: d"].join("\n")),
            ["[foo]: <a", "", ...Array.from({ length: 60 }, (_, i) => [`Paragraph ${i} of the address`, ""]).flat(), "c>", "", "use[^1]", "", "[^1]: d"].join("\n"),
        ];
        expect(notes.map((note) => difference(note.split("\n")))).toEqual(notes.map(() => null));
    });

    // An "<a ...>" tag in running text changes how the parser reads what
    // follows: until a "</a>", it reads no link and no bare address, across
    // blocks, for the rest of the note. Obsidian does the same, live on 1.15.0
    // (hunt 2026-11-06, cycle 9, finding H1; live answers H1a to H1g). So
    // this is the one thing a part can leave behind besides an open block, and
    // a part that leaves it open must not end there. Each note below runs
    // over 200 paragraphs, enough that parts start inside it.
    describe("an <a> tag left open carries through the parts as through the whole note", () => {
        const Fill = Array.from({ length: 200 }, (_, i) => [`Paragraph number ${i} of the note, with some words.`, ""]).flat();
        const Later = ["See [the report](http://example.com/report) here.", "", "See http://example.com/bare too.", "", "See [the report][^1] too.", "", "[Foo] and [Foo][]", "", "[Foo]: http://example.com", "", "[^1]: one"];
        const reads = (head: string): string | null => difference([...head.split("\n"), "", ...Fill, ...Later]);

        it.each([
            'Jump back to <a name="top"> the top.',
            "Jump back to <A NAME=top> the top.",
            '## Results <a id="results"/>',
            '- item <a id="q"/>',
            '> quoted <a id="q"/>',
            '> [!note] title <a id="q"/>',
            '| a <a id="q"/> |\n| - |',
            '[^9]: a source <a id="q"/>',
            'x ==marked <a id="q"/> text== y',
            'x ^[inline <a id="q"/> note] y',
            'x %% comment <a id="q"/> %% y',
            '%%\nblock <a id="q"/> comment\n%%',
            'x **bold <a id="q"/> text** y',
        ])("left open by: %s", (head) => {
            expect(reads(head)).toBeNull();
        });

        it.each([
            'Jump <a name="top"> up</a> now.',
            'Jump to <a name="top"></a> the top.',
            '<a name="top">',
            '`<a id="q"/>`',
            '<!-- <a id="q"/> -->',
            '[text <a id="q"/> more](http://example.com)',
            '[text <a id="q"/> more]',
            '```\n<a id="q"/>\n```',
            "<a\tid=q> and <abbr title=q> and <a",
        ])("not left open by: %s", (head) => {
            expect(reads(head)).toBeNull();
        });

        it.each([
            ["a later paragraph", "Closed </a> here."],
            ["a later list item", "- closed </a> here"],
            ["what looks like a link's text, which no link is read from under an open tag", "[closed </a> here](http://example.com)"],
        ])("closed by %s, with links read as links again below it", (_, closer) => {
            expect(difference(['Open <a id="q"> here.', "", ...Fill, closer, "", ...Fill, ...Later])).toBeNull();
        });

        it.each([
            ["a code span", "Not closed `</a>` here."],
            ["a code block", "```\n</a>\n```"],
            ["an HTML comment", "<!-- </a> -->"],
        ])("stays open past a closer in %s", (_, closer) => {
            expect(difference(['Open <a id="q"> here.', "", ...Fill, ...closer.split("\n"), "", ...Fill, ...Later])).toBeNull();
        });

        // A part's last line is borrowed from the next part, so what counts is
        // whether the tag is open before that line. Which lines start a part
        // depends on a hash of their text, so each row is tried with 64
        // different texts, of which about eight start a part.
        it("reads a line that a part borrows by what comes before it", () => {
            const notes = Array.from({ length: 64 }, (_, i) => [
                // the tag opened above and closed on the line that may be borrowed: its link stays plain text
                ['Open <a id="q"> here.', "", `[l](u) </a> closes ${i}.`, "", ...Later],
                // the tag opened on the line that may be borrowed: the part above it still ends cleanly
                ["Plain text.", "", `Opens <a id="q"> at ${i}.`, "", ...Later],
                // opened and closed in separate blocks, each of which may start a part
                ['Open <a id="q"> here.', "", `</a> closes ${i}.`, "", `[l](u) opens <a id="q"> at ${i}.`, "", ...Later],
            ]).flat();
            expect(notes.map((note) => difference(note))).toEqual(notes.map(() => null));
        });

        it("reads such notes as the whole note does while they are edited at random", () => {
            const r = random(20261106 + Seed);
            const notes = Array.from({ length: 12 }, () => {
                const lines = Fill.slice(0, 80);
                for (const shape of ['Open <a id="q"> here.', "Closed </a> here.", ...Later]) lines.splice(Math.floor(r() * lines.length) & ~1, 0, shape, "");
                return lines.join("\n");
            });
            expect(differences(notes, GeneratedEdits, 20261107 + Seed)).toEqual([]);
        }, 120000 * Soak);
    });

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

    // A tag left open far up must not make every press on a long note parse
    // from the tag down (hunt 2026-11-06, cycle 9, finding H1).
    it.each([
        ["left open far up", 'Jump back to <a name="top"> the top.'],
        ["left open and closed further down", 'Jump back to <a name="top"> the top.\n\nThis closes </a> it.'],
    ])("parses only the part an edit falls in, with an <a> tag %s", (_, head) => {
        const lines = [...head.split("\n"), "", ...note(200, "open tag")];
        const whole = readNote(lines);
        expect(whole.references.length).toBe(200);
        const before = partParseCounts();
        const edited = [...lines];
        const line = edited.indexOf("It goes on a little.", 300);
        edited[line] = "It goes on a little longer.";
        readNote(edited);
        expect(partParseCounts().parsed - before.parsed).toBe(1);
        expect(partParseCounts().unclean).toBe(before.unclean);
    });

    it("parses the parts below again when an edit closes the tag above them, since they now read differently", () => {
        const lines = ['Jump back to <a name="top"> the top.', "", ...note(200, "closing tag"), "See [l](u) too."];
        expect(readNote(lines).links.map((link) => link.lookup)).toEqual(["l"]);
        const before = partParseCounts().parsed;
        const edited = [...lines];
        edited[0] = 'Jump back to <a name="top"> the top.</a>';
        expect(readNote(edited).links.map((link) => link.lookup)).toEqual([undefined]);
        expect(partParseCounts().parsed - before).toBeGreaterThan(5);
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
