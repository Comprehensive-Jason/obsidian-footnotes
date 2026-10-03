import { describe, expect, it } from "vitest";

import { parseCount, readNote } from "../src/parsing/note-reading";

// The note reading (src/parsing/note-reading.ts): every definition with its
// container, the label lines, the definition that owns a line, and the
// cache that parses each distinct text once.

/** Each definition as [name, label line, last line, quotes, list items, footnotes, movable, removable]. */
function definitionsOf(lines: string[]) {
    return readNote(lines).definitions.map((d) => [
        d.name,
        d.start,
        d.end,
        d.container.quotes,
        d.container.listItems,
        d.container.footnotes,
        d.movable,
        d.removable,
    ]);
}

describe("readNote: definitions and their containers", () => {
    it("reads a definition wherever it sits, with what holds it (Jason's ruling 1, option a, 2026-10-03)", () => {
        const lines = [
            "[^top]: at the top level",
            "",
            "> [^q]: in a quote",
            "",
            "- [^l]: in a list item",
            "",
            "> - [^ql]: in a list item in a quote",
            "",
            "[^outer]: outer",
            "",
            "    [^inner]: nested inside outer",
        ];
        expect(definitionsOf(lines)).toEqual([
            ["top", 0, 0, 0, 0, 0, true, true],
            ["q", 2, 2, 1, 0, 0, false, true],
            ["l", 4, 4, 0, 1, 0, false, true],
            ["ql", 6, 6, 1, 1, 0, false, true],
            ["outer", 8, 10, 0, 0, 0, true, true],
            ["inner", 10, 10, 0, 0, 1, false, true],
        ]);
    });

    it("gives the label's columns: its '[' and just past its ':'", () => {
        const [top, item] = readNote(["   [^ab]: x", "", "- [ ] [^c]: task"]).definitions;
        expect([top.labelStart, top.labelEnd]).toEqual([3, 9]);
        expect([item.labelStart, item.labelEnd]).toEqual([6, 11]);
    });

    it("keeps a label that follows other text on its line from being moved or cut", () => {
        // a "%%" closer, a callout title, a frontmatter closer, and a second label on one line
        const closer = readNote(["%% c", "%% [^a]: after the closer"]).definitions[0];
        expect([closer.name, closer.movable, closer.removable]).toEqual(["a", false, false]);
        const title = readNote(["> [!note] [^b]: on the title line"]).definitions[0];
        expect([title.name, title.movable, title.removable]).toEqual(["b", false, false]);
        const front = readNote(["---", "a: 1", "---[^c]: after frontmatter"]).definitions[0];
        expect([front.name, front.movable, front.removable]).toEqual(["c", false, false]);
        expect(definitionsOf(["[^1]: [^2]: x"])).toEqual([
            ["1", 0, 0, 0, 0, 0, true, true],
            ["2", 0, 0, 0, 0, 1, false, false],
        ]);
    });

    it("reads a label under prose as lazy text, not a definition", () => {
        expect(readNote(["prose", "[^1]: lazy"]).definitions).toEqual([]);
        expect(readNote(["para", "2. [^x]: def"]).definitions).toEqual([]);
    });
});

describe("readNote: lines", () => {
    it("marks the lines that hold a label, and finds the innermost definition owning a line", () => {
        const reading = readNote(["text[^a]", "", "[^a]: one", "    more", "", "    [^b]: inner", "", "after"]);
        expect(reading.labelLines).toEqual([false, false, true, false, false, true, false, false]);
        expect(reading.labelOn(2)?.name).toBe("a");
        expect(reading.labelOn(3)).toBeNull();
        expect([0, 2, 3, 4, 5, 6, 7].map((l) => reading.definitionAt(l)?.name ?? null)).toEqual([null, "a", "a", "a", "b", null, null]);
    });

    it("drops a stray carriage return at a line's end and keeps every line where it was", () => {
        const reading = readNote(["a[^1]\r", "\r", "[^1]: d\r"]);
        expect(reading.definitions.map((d) => [d.start, d.end])).toEqual([[2, 2]]);
        // a "\r" inside a line is not a line break here
        expect(readNote(["x\ry[^1]", "", "[^1]: d"]).definitions.map((d) => d.start)).toEqual([2]);
    });
});

describe("readNote: the cache", () => {
    it("parses a text once, and again only when it changes", () => {
        const lines = ["cache probe[^1]", "", "[^1]: one"];
        const before = parseCount();
        const first = readNote(lines);
        expect(readNote([...lines])).toBe(first);
        expect(parseCount()).toBe(before + 1);
        readNote([...lines, "more"]);
        expect(parseCount()).toBe(before + 2);
    });

    it("forgets the oldest text once it holds more than four", () => {
        const notes = [0, 1, 2, 3, 4].map((n) => [`note ${n} for the cache[^1]`, "", "[^1]: d"]);
        for (const note of notes) readNote(note);
        const before = parseCount();
        readNote(notes[4]);
        readNote(notes[1]);
        expect(parseCount()).toBe(before);
        readNote(notes[0]);
        expect(parseCount()).toBe(before + 1);
    });
});
