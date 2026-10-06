import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { SavedAnswer } from "../scripts/oracle/compare.mjs";
import { generateBroadNotes, generateNotes } from "../scripts/oracle/generate.mjs";
import { parseObsidianNote } from "../src/parsing/obsidian-markdown";

// The reader's two speed-ups of 2026-10-05 (the speed brief) change how
// fast a note is read and nothing else: the vendored tokenizer loop, which
// skips remark-parse's check on every piece a reader takes
// (src/parsing/remark-parse-tokenizer.js), and plain text with no "&" taken
// as it stands instead of walked for character references (textLineByLine
// in src/parsing/obsidian-markdown.ts). This is a differential test: the
// same note is parsed by the parser with the speed-ups and by the one
// without them (the stock loop, its check included), and everything the
// parse gives back must be the same, every node, position, and per-line
// count. It runs on every note saved with Obsidian's answers, on notes the
// oracle's generators make, and on all of them again with character
// references written in, since those are what the plain-text speed-up
// leaves to the stock decoder.

/** Every note saved with Obsidian's answers in test/obsidian-answers/. */
function savedNotes(): string[] {
    const dir = new URL("./obsidian-answers/", import.meta.url);
    return readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .flatMap((file) => (JSON.parse(readFileSync(new URL(file, dir), "utf8")) as SavedAnswer[]).map((answer) => answer.text));
}

/**
 * Character references and look-alikes: known and unknown names, with and
 * without the closing ";", numbers in decimal and hexadecimal, an "&" alone,
 * and one before another "&". The decoder turns some into a character and
 * leaves the rest as text.
 */
const Entities = ["&amp;", "&copy", "&copy;", "&#169;", "&#x26;", "&#;", "&;", "& ", "&&", "&nosuch;", "&lt;b&gt;", "AT&T", "&#0;", "&#xD800;"];

/** `note` with a character reference written in after every third space, cycling through Entities from `start`. */
function withEntities(note: string, start: number): string {
    let spaces = 0;
    let next = start;
    return note.replace(/ /g, () => {
        spaces++;
        if (spaces % 3 !== 0) return " ";
        return ` ${Entities[next++ % Entities.length]} `;
    });
}

/** Everything one parse gives back, as one string to compare. */
function parsed(note: string, startsNote: boolean, speedUps: boolean): string {
    return JSON.stringify(parseObsidianNote(note, startsNote, speedUps));
}

/**
 * The notes on which the two parsers disagree, the first few of them. Every
 * other note is read as a later part of a note (no frontmatter), as the
 * note reading reads all but a note's first part, so both kinds of read are
 * covered without parsing every note four times.
 */
function disagreements(notes: string[]): string[] {
    const found: string[] = [];
    notes.forEach((note, i) => {
        const startsNote = i % 2 === 0;
        if (found.length < 5 && parsed(note, startsNote, true) !== parsed(note, startsNote, false)) found.push(JSON.stringify(note.slice(0, 200)));
    });
    return found;
}

describe("the reader's speed-ups read every note exactly as the stock remark-parse loop does", () => {
    const saved = savedNotes();
    const generated = [...generateNotes(20261005, 300), ...generateBroadNotes(20261006, 300)];

    it("the corpus is there to compare (thousands of saved notes)", () => {
        expect(saved.length).toBeGreaterThan(5000);
    });

    it("every saved note", () => {
        expect(disagreements(saved)).toEqual([]);
    }, 120_000);

    it("every saved note with character references written in", () => {
        expect(disagreements(saved.map((note, i) => withEntities(note, i)))).toEqual([]);
    }, 120_000);

    it("generated notes, as they come and with character references written in", () => {
        expect(disagreements([...generated, ...generated.map((note, i) => withEntities(note, i))])).toEqual([]);
    }, 120_000);

    it("the entity variants do reach the decoder (a check on the test itself)", () => {
        // a decoded reference is a text node of its own, one character long
        // and five columns wide, so a slip in the speed-up would show
        const tree = JSON.stringify(parseObsidianNote("Fish &amp; chips &copy; AT&T.").tree);
        expect(tree).toContain('"value":"&","position":{"start":{"line":1,"column":6,"offset":5},"end":{"line":1,"column":11,"offset":10}');
        expect(tree).toContain('"value":"©"');
    });
});
