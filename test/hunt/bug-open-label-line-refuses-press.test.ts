import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// BUG (annoyance): a press at the end of ordinary prose is refused when a
// line further down holds a lone "[".
//
// What the user would see: the note reads "text here", a blank line, a
// line holding just "[", a blank line, and "para". They put the caret at
// the end of "text here" and press the footnote key. Nothing is written,
// and the toast blames protected text, though the caret is in plain
// prose.
//
// Hunt 2026-10-05, round 1, lens reading. Cluster RD3.
//
// Source of truth: Obsidian's answer swap34:lrd-label-blank-para (a link
// definition's label left open, "[" with no "]", swallows what follows
// over blank lines, so "[\n\npara\n\n[^1]: def" shows no footnote) and
// swap34:lrd-label-after-para; the docstring of openRegionFrom, which
// says the region starts at the outermost protected stretch that takes
// in a definition written after the note's end.
//
// Cause: openRegionFrom (the first line of a region still open at the
// note's end) sees that the probe definition it appends is swallowed, but
// no protected span covers the swallowed text, so it falls back to the
// note's last line instead of the line of the "[". The definition the
// press would write is then placed below the "[", where it is swallowed
// too, and the press is refused.

describe("openRegionFrom for an open link-definition label", () => {
    beforeEach(resetNotices);

    it("says the region starts at the line of the open '['", () => {
        // Today: 4, the note's last line.
        expect(readNote(["text here", "", "[", "", "para"]).openRegionFrom).toBe(2);
        expect(readNote(["text here", "", "[a", "", "b"]).openRegionFrom).toBe(2);
    });

    it("a press at the end of plain prose above an open '[' makes a footnote whose definition Obsidian reads", async () => {
        // A control: ["text here", "", "[x"] works (the definition goes above the "[x" line).
        const lines = ["text here", "", "[", "", "para"];
        const doc = fakeEditor(lines, { wholeDoc: true, edits: true, words: true, cursor: { line: 0, ch: 9 } });
        await insertAutonumFootnote(fakePlugin({}, doc));
        // Today: the protected-text toast, and the note is unchanged.
        expect(messages()).toEqual([]);
        expect(doc.lines[0]).toBe("text here[^1]");
        const typed = doc.lines.map((line) => (line === "[^1]: " ? "[^1]: body" : line));
        expect(readNote(typed).definitions.map((d) => d.name)).toEqual(["1"]);
    });
});
