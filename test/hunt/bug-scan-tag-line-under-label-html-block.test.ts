import { describe, expect, it } from "vitest";

import { referenceOccurrences } from "../../src/parsing/footnote-grammar";
import {
    definitionStartLines,
    findDefinitionBlocks,
    maskProtectedLines,
    scanDocument,
} from "../../src/parsing/markdown-scan";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (wrong output on default settings): a tag line such as "<span>"
// directly under a label line is read two ways at once, and the default
// lint strands it outside its footnote.
//
// What the user would see: the definition "[^1]: body" is followed
// directly by "<span>" and "more text". In CommonMark a line like "<span>"
// (an HTML block of type 7, a lone tag) cannot interrupt a paragraph, so
// both lines carry on footnote 1's text. The plugin's scanner reads
// "<span>" as the start of an HTML block, while its block walker treats it
// as footnote text. The default lint moves "[^1]: body" to the bottom and
// leaves "<span>" and "more text" behind in the note. Under a lazy label
// (a line under prose that looks like a definition), the "[^2]" on the
// line after "<span>" is read as hidden HTML instead of a live reference.
//
// Needs a Reading-view check: micromark gives the CommonMark reading;
// Obsidian itself has not been probed for these shapes. The quoted twin
// ("> <span>" under "> [^1]: body") is already read as footnote text.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X5.
//
// Source of truth: CommonMark 4.6 (an HTML block of type 7 cannot
// interrupt a paragraph, and a label line's text is a paragraph).

// What the plugin reads in `doc`: the scan, the definition blocks, and every live reference as "line:name".
function facts(doc: string) {
    const lines = doc.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    const starts = definitionStartLines(lines, scan, (i) => masked[i]);
    const blocks = findDefinitionBlocks(lines, scan, masked, starts);
    const live = lines.flatMap((l, i) => referenceOccurrences(l, masked[i], starts[i]).map((o) => `${i}:${o.name}`));
    return { scan, blocks, live };
}

describe("a type-7 tag line under a definition's own paragraph", () => {
    it.fails("'<span>' directly under a lazy label is paragraph text, not an HTML block", () => {
        const f = facts("para\n[^1]: x\n<span>\nsee [^2]\n\n[^2]: two");
        expect(f.scan.isProtected.slice(0, 4)).toEqual([false, false, false, false]);
        expect(f.live).toContain("3:2");
    });

    it.fails("'<span>' directly under a label line is the footnote's lazy body, not an HTML block", () => {
        const f = facts("[^1]: body\n<span>\nmore [^2]\n\nx[^1]\n\n[^2]: two");
        expect(f.scan.isProtected.slice(0, 3)).toEqual([false, false, false]);
        expect(f.blocks[0]).toMatchObject({ name: "1", start: 0, end: 2 });
    });

    it.fails("the default lint keeps '<span>' and the line under it inside footnote 1's body", () => {
        const doc = "x[^1]\n\n[^1]: body\n<span>\nmore text\n\nlast paragraph";
        // Today: "x[^1]\n\n<span>\nmore text\n\nlast paragraph\n\n[^1]: body".
        expect(lintFootnotes(doc)).toContain("[^1]: body\n<span>\nmore text");
    });
});
