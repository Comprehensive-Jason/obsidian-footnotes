import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, noticed, resetNotices } from "./helpers/notices";
import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";
import { BlockSyntaxNotice } from "../src/editor/notice";
import { readNote } from "../src/parsing/note-reading";

// Jason's rulings 4 and 5 (2026-09-20): a press with the caret in front
// of a blockquote marker, or on a setext underline line, refuses. Before,
// the first wrote the reference before the ">" and the line dropped out of
// its quote ("[^1]> text" is a paragraph), and the second wrote it into
// the underline, which stopped being one, so the heading above turned back
// into prose. The table delimiter-row press already refused for the same
// reason.
//
// On 2026-10-03 Jason extended this to every kind of block syntax: a
// press never writes into it. A caret in front of or inside a list marker
// (between an ordered marker's digit and its "." or ")" too), a task box,
// or a heading's "#" marks, or anywhere on a thematic break, refuses the
// same way, with a notice of its own (BlockSyntaxNotice, his wording of
// the same day). The note reading says where each line's text starts.

/** Press the numbered key at line, ch of `note`, and hand back the editor. */
async function press(note: string[], line: number, ch: number) {
    const doc = fakeEditor(note, { wholeDoc: true, edits: true, words: true, cursor: { line, ch } });
    await insertAutonumFootnote(fakePlugin({}, doc));
    return doc;
}

describe("a press with the caret in front of a quote marker (ruling 4)", () => {
    beforeEach(resetNotices);

    it("refuses at column 0 of a quoted line", async () => {
        const before = ["> A quoted line.", "> Another quoted line."];
        const doc = await press(before, 1, 0);
        expect(doc.lines).toEqual(before);
        expect(noticed(BlockSyntaxNotice)).toBe(true);
    });

    it("refuses between the markers of a nested quote", async () => {
        const before = ["> > deep text", "> > more deep text"];
        const doc = await press(before, 1, 2);
        expect(doc.lines).toEqual(before);
        expect(noticed(BlockSyntaxNotice)).toBe(true);
    });

    it("control: after the marker and its space the press creates as usual", async () => {
        const doc = await press(["> A quoted line.", "> Another quoted line."], 1, 2);
        expect(doc.lines[1]).toContain("[^1]");
        expect(doc.lines[1].startsWith("> ")).toBe(true);
        expect(messages()).toEqual([]);
    });
});

describe("a press with the caret in a list marker, a task box, or a heading's marks (2026-10-03)", () => {
    beforeEach(resetNotices);

    for (const [note, line, ch] of [
        [["- item"], 0, 0],
        [["- item"], 0, 1],
        [["* item"], 0, 0],
        [["+ item"], 0, 0],
        [["1. item"], 0, 0],
        [["1) item"], 0, 0],
        // between the digit and the "." or ")"
        [["1. first", "2. second"], 1, 1],
        [["1) first"], 0, 1],
        [["- item", "  - nested item"], 1, 2],
        [["- item", "  - nested item"], 1, 0],
        [["> - quoted item"], 0, 2],
        [["- - inner item"], 0, 2],
        [["- item", "", "    [^1]: in-item definition"], 0, 0],
        // inside a task box
        [["- [ ] task"], 0, 3],
        [["- [x] done"], 0, 4],
        // in front of and between a heading's "#" marks
        [["# Heading"], 0, 0],
        [["## Heading", "", "More."], 0, 1],
        [["> ## Quoted heading"], 0, 3],
    ] as [string[], number, number][]) {
        it(`refuses at ch ${ch} of ${JSON.stringify(note[line])}`, async () => {
            const doc = await press(note, line, ch);
            expect(doc.lines).toEqual(note);
            expect(noticed(BlockSyntaxNotice)).toBe(true);
        });
    }

    for (const [note, line, ch] of [
        [["- item"], 0, 2],
        [["2. second"], 0, 3],
        [["- [ ] task"], 0, 6],
        [["## Heading"], 0, 3],
    ] as [string[], number, number][]) {
        it(`control: at the start of the text, ch ${ch} of ${JSON.stringify(note[line])}, the press creates as usual`, async () => {
            const doc = await press(note, line, ch);
            expect(doc.lines[line]).toContain("[^1]");
            expect(doc.lines[line].startsWith(note[line].slice(0, ch))).toBe(true);
            expect(messages()).toEqual([]);
        });
    }

    it("control: a dash that starts no list item is prose and takes the press", async () => {
        const doc = await press(["-5 degrees"], 0, 0);
        expect(doc.lines[0]).toContain("[^1]");
        expect(messages()).toEqual([]);
    });

    it("control: a \"#\" with no space after it is prose and takes the press", async () => {
        const doc = await press(["#hashtag text"], 0, 0);
        expect(doc.lines[0]).toContain("[^1]");
        expect(messages()).toEqual([]);
    });
});

describe("a press on a thematic break (2026-10-03)", () => {
    beforeEach(resetNotices);

    for (const rule of ["---", "***", "___", "- - -"]) {
        for (const ch of [0, rule.length]) {
            it(`refuses at ch ${ch} of ${JSON.stringify(rule)}`, async () => {
                const note = ["Prose above.", "", rule, "", "Prose below."];
                const doc = await press(note, 2, ch);
                expect(doc.lines).toEqual(note);
                expect(noticed(BlockSyntaxNotice)).toBe(true);
            });
        }
    }
});

describe("a press with the caret on a setext underline line (ruling 5)", () => {
    beforeEach(resetNotices);

    it("the reading reads an underline that heads the line above as block syntax to its end", () => {
        const ends = (lines: string[]) => lines.map((_, i) => readNote(lines).blockSyntaxEnd(i));
        expect(ends(["Setext heading", "==============", "", "prose"])).toEqual([0, Infinity, 0, 0]);
        expect(ends(["Dash heading", "---"])).toEqual([0, Infinity]);
        // literal under a two-line paragraph, and body text under a
        // definition's indented continuation: no underline, so no syntax
        expect(ends(["para", "more", "==="])).toEqual([0, 0, 0]);
        expect(ends(["[^1]: x", "    y", "==="])[2]).toBe(0);
        // a heading's marks, a list marker, and a quote marker
        expect(["## Heading", "- item", "> quoted", "1. first", "- [ ] task"].map((line) => ends([line])[0])).toEqual([3, 2, 2, 3, 6]);
    });

    it("refuses at the end of an equals underline", async () => {
        const before = ["Setext heading", "==============", "", "Some prose after it."];
        const doc = await press(before, 1, 14);
        expect(doc.lines).toEqual(before);
        expect(noticed(BlockSyntaxNotice)).toBe(true);
    });

    it("refuses on a dash underline", async () => {
        const before = ["Dash heading", "---", "", "prose"];
        const doc = await press(before, 1, 3);
        expect(doc.lines).toEqual(before);
        expect(noticed(BlockSyntaxNotice)).toBe(true);
    });

    it("control: a literal \"===\" under a two-line paragraph takes the press", async () => {
        const doc = await press(["para", "more", "===", "", "prose"], 2, 3);
        expect(doc.lines[2]).toContain("[^1]");
        expect(messages()).toEqual([]);
    });
});
