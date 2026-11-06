import { describe, expect, it } from "vitest";

import { footnoteFacts } from "../src/parsing/footnote-facts";
import { cellLinkLikeEndAt } from "../src/parsing/landing";
import { readNote, partParseCounts } from "../src/parsing/note-reading";
import { parseObsidianNote } from "../src/parsing/obsidian-markdown";

// What the adapter in src/parsing/obsidian-markdown.ts puts back on top of
// the remark-obsidian package's tree (run rmk-vet, 2026-11-05). These are
// characterization tests: each pins what the plugin read from the parser it
// had before, except where a comment says the adapter reads better than
// that. All but the byte order mark group and the "[a]: <" row of the
// readsPastEnd table also pass against the old parser at 7695018, so they
// say the swap kept these readings.

describe("bracketed text whose label nothing in the text defines", () => {
    it("stays a link fact, judged later against all the note's labels", () => {
        const { links } = footnoteFacts("[a] ![b] [c][] [d][e]\n");
        expect(links.map((link) => [link.start, link.end, link.lookup])).toEqual([
            [0, 3, "a"],
            [4, 8, "b"],
            [9, 14, "c"],
            [15, 21, "e"],
        ]);
    });

    it("is drawn when its definition sits in another part of a long note", () => {
        const body: string[] = [];
        for (let i = 0; i < 400; i++) body.push(`Paragraph number ${i} with some words.`, "");
        const lines = ["See [alpha] and [beta][] and ![gamma].", "", ...body, "[alpha]: http://a", "[beta]: http://b", "[gamma]: http://c"];
        const before = partParseCounts().parsed;
        const reading = readNote(lines);
        expect(partParseCounts().parsed - before).toBeGreaterThan(1);
        expect(reading.links.map((link) => link.lookup)).toEqual(["alpha", "beta", "gamma"]);
        expect([...reading.linkLabels].sort()).toEqual(["alpha", "beta", "gamma"]);
        expect(reading.links).toEqual(footnoteFacts(lines.join("\n")).links);
    });

    it("is drawn in a table cell when the note defines its label, which the cell cannot see", () => {
        expect(cellLinkLikeEndAt("[a] b", 1, new Set(["a"]))).toBe(3);
        expect(cellLinkLikeEndAt("[a] b", 1, new Set())).toBe(-1);
    });

    it("keeps a label's outer spaces, so [ a ] does not look up [a]", () => {
        const { links, linkDefinitions } = footnoteFacts("[ a ] [a]\n\n[a]: http://x\n");
        expect(links.map((link) => link.lookup)).toEqual([" a ", "a"]);
        expect(linkDefinitions.map((definition) => definition.label)).toEqual(["a"]);
    });

    it("spans several children and several lines", () => {
        const { links } = footnoteFacts("[a *b* c\nd] e\n");
        expect(links).toEqual([{ startLine: 0, start: 0, endLine: 1, end: 2, lookup: "a *b* c d" }]);
    });

    it("takes a [ that never closes with it, as the reader does", () => {
        expect(footnoteFacts("[a][b\n").links.map((link) => [link.start, link.end, link.lookup])).toEqual([[0, 4, "a"]]);
        expect(footnoteFacts("[][b\n").links.map((link) => [link.start, link.end, link.lookup])).toEqual([[0, 3, ""]]);
    });

    it("is not found where the reader never looks", () => {
        // "[^" is left to the footnote readers, whatever follows it
        expect(footnoteFacts("[^a b] [^]\n").links).toEqual([]);
        // an escaped bracket, empty brackets, and brackets holding brackets
        expect(footnoteFacts("\\[a] [] [a [b\n").links).toEqual([]);
        // a bare address holds only its own text
        expect(footnoteFacts("http://a.b![c]\n").links).toEqual([{ startLine: 0, start: 0, endLine: 0, end: 14 }]);
        // a link holds no links, but it may hold an image
        expect(footnoteFacts("[a [b] c](u)\n").links.map((link) => link.lookup)).toEqual([undefined]);
        expect(footnoteFacts("[![b]](u)\n").links.map((link) => link.lookup)).toEqual([undefined, "b"]);
    });
});

describe("a reference inside an inline footnote", () => {
    it("counts as a dead reference", () => {
        const { references, inlineNotes } = footnoteFacts("^[x [^2] y [^b]] [^1]\n");
        expect(references).toEqual([
            { name: "2", line: 0, start: 4, end: 8, live: false },
            { name: "b", line: 0, start: 11, end: 15, live: false },
            { name: "1", line: 0, start: 17, end: 21, live: true },
        ]);
        expect(inlineNotes).toEqual([{ line: 0, open: 0, closeLine: 0, close: 15 }]);
    });

    it("is not one where the reader would not read one", () => {
        expect(footnoteFacts("^[x \\[^2] [^a b]]\n").references).toEqual([]);
    });
});

describe("a callout", () => {
    it("reads as a quote with a title holding the blocks on its line", () => {
        expect(footnoteFacts("> [!note] Title\n> body\n").lineBlocks).toEqual(["blockquote ^calloutTitle ^paragraph", "blockquote ^paragraph", ""]);
        const titled = footnoteFacts("> [!note] [^1]: def\n> body\n");
        expect(titled.lineBlocks[0]).toBe("blockquote ^calloutTitle ^footnoteDefinition ^paragraph");
        expect(titled.definitions.map((definition) => [definition.name, definition.labelStart, definition.container.quotes])).toEqual([["1", 10, 1]]);
    });

    it("with nothing after its marker is block syntax to the line's end", () => {
        const { blockSyntax, lineBlocks } = footnoteFacts("> [!note]\n> body\n");
        expect(blockSyntax).toContainEqual({ line: 0, end: Infinity, container: true });
        expect(lineBlocks[0]).toBe("blockquote ^calloutTitle");
    });

    it("sits at its own place inside other containers", () => {
        expect(footnoteFacts("- > [!note] t\n").lineBlocks[0]).toBe("^list ^listItem blockquote ^calloutTitle ^paragraph");
        expect(footnoteFacts("> > [!note] t\n").lineBlocks[0]).toBe("blockquote blockquote ^calloutTitle ^paragraph");
    });
});

describe("a %% comment", () => {
    it("is a block on its own lines and a span inside a paragraph", () => {
        const spans = footnoteFacts("%%\na\n%%\n\nb %% c %% d\n").protectedSpans;
        expect(spans.map((span) => [span.kind, span.block])).toEqual([
            ["percentComment", true],
            ["percentComment", false],
        ]);
    });
});

// The old parser placed a line's first column one short after a byte order
// mark when a container held the line, and read no callout on that line. The
// adapter's columns are the true ones, so this group does not pass there.
describe("a note that starts with a byte order mark", () => {
    it("counts the mark in offsets and in the first line's columns", () => {
        const text = "﻿- a[^1]\nb[^2]\n";
        const { references } = footnoteFacts(text);
        expect(references.map((reference) => [reference.line, reference.start])).toEqual([
            [0, 4],
            [1, 1],
        ]);
        expect(text.slice(4, 8)).toBe("[^1]");
        expect(readNote(text.split("\n")).containerEnd(0)).toBe(3);
    });

    it("keeps reading frontmatter", () => {
        expect(footnoteFacts("﻿---\na: 1\n---\nb[^1]\n").protectedSpans.map((span) => [span.kind, span.from, span.to])).toEqual([["frontmatter", 1, 13]]);
    });
});

describe("readsPastEnd", () => {
    it.each([
        ["[", true],
        ["[a", true],
        ["[a\n\nb", true],
        ["  [", true],
        ["[\\", true],
        ["[a]:", true],
        ["[a]: ", true],
        ["[a]:\n\n", true],
        // the old parser said no here; yes costs only a longer part, and "<x>" written after it would make a definition
        ["[a]: <", true],
        ["[a]: <x", true],
        ['[a]: x "', true],
        ['[a]: x "t', true],
        ["[a]: x 't", true],
        ["[a]: x (t", true],
        ['[a]: x\n"t', true],
        ['[a]: x "t\nu', true],
        ["[a | b\n--|--", true],
        ["[a]", false],
        ["[]", false],
        ["[]:", false],
        ["[^a", false],
        ["[a]: x", false],
        ["[a]: <x>", false],
        ['[a]: x "t"', false],
        ["[a]: x y", false],
        ['[a]: x "t" y', false],
        ["[a](u)", false],
        ["plain", false],
        ["# [a", false],
        ["a\n[b", false],
    ])("%j reads past the end: %j", (text, expected) => {
        expect(parseObsidianNote(text).readsPastEnd).toBe(expected);
    });
});
