import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// BUG (wrong output, low): a label at column 0 directly under an HTML
// block inside a blockquote is read as a definition, though Reading view
// swallows it into the HTML block.
//
// What the user would see: a blockquote holds an HTML block, "> <div>"
// and "> more html", and the next line, with no ">" and no blank line in
// between, is "[^1]: def". Reading view shows no footnote: the line is
// taken into the quote's HTML block. The plugin reads "[^1]: def" as a
// working definition, so footnote 1 looks defined to every command and
// lint rule, and nothing tells the user it does not show.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X10.
//
// Source of truth: the REFUTED note at the top of
// bug-ends-protected-quoted-html-block.test.ts (GLM hunt cycle 7, probed
// in Reading view 2026-09-16): a column-0 line directly under a quoted
// HTML block "renders NO footnote" because it is "lazily swallowed by the
// quote's HTML block". The scanner already agrees that the note ends
// protected there; it does not yet mark the line itself.

describe("a label at column 0 directly under a quoted HTML block", () => {
    it("is swallowed, not a definition", () => {
        const lines = "text[^1]\n\n> <div>\n> more html\n[^1]: def".split("\n");
        const reading = readNote(lines);
        const starts = readNote(lines).labelLines;
        expect(starts[4]).toBe(false);
        expect(reading.protectedLines[4]).toBe(true);
    });
});
