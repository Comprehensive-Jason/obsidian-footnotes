import { describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): an inline footnote nested inside one that runs over two lines is treated
// as a footnote of its own.
//
// What the user would see: in "a ^[x" / "y ^[z] w] v", the "^[z]" is text inside the outer
// inline footnote's body. The punctuation rule (part of the default lint) moves it as if it
// were a footnote in the prose, rewriting "^[z]." to ".^[z]" inside the outer body; and Convert
// inline to normal turns it into a "[^1]" reference inside the outer footnote's body with a
// "[^1]: z" definition below, a reference Obsidian does not read as one there and a definition
// nothing references. On one line ("a ^[x ^[z] w] v") both leave the nested one alone.
//
// An "inline footnote" is "^[text]" written in the line itself; Obsidian lets one run over the
// line breaks of its paragraph (2e58d86).
//
// Hunt 2026-10-05, round 2, lens reader. Cluster R3.
//
// Source of truth: the one-line behaviour (the controls), and the note reading itself, which
// sees the outer footnote holding the nested one (inlineNoteHolding in the first red test).
//
// Cause: NoteReading.inlineNotesOn in src/parsing/note-reading.ts drops every inline footnote
// that runs over a line break (closeLine !== line) BEFORE it drops the ones held inside
// another, so a one-line footnote nested in a multi-line one comes back as an outermost one.
// Convert inline to normal and the punctuation rule both list a line's footnotes through it.

function convert(lines: string[]) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
    convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
    return doc.lines;
}

describe("an inline footnote nested in a multi-line one", () => {
    it("control: the reading: on one line the nested one is not among the line's inline footnotes", () => {
        expect(readNote(["a ^[x ^[z] w] v"]).inlineNotesOn(0)).toEqual([{ open: 2, close: 12 }]);
    });

    // Today inlineNotesOn(1) returns [{ open: 2, close: 5 }], the nested one.
    it.fails("the reading: under a multi-line one it is not among its line's inline footnotes either", () => {
        const reading = readNote(["a ^[x", "y ^[z] w] v"]);
        // the reader itself sees the outer one holding it
        expect(reading.inlineNoteHolding(1, 4)).toMatchObject({ line: 1, open: 2 });
        expect(reading.inlineNoteHolding(1, 8)).toMatchObject({ line: 0, open: 2, closeLine: 1, close: 8 });
        expect(reading.inlineNotesOn(1)).toEqual([]);
    });

    it("control: the punctuation rule (default lint) leaves a nested one on one line alone", () => {
        expect(footnoteAfterPunctuation("a ^[x ^[z]. w] v")).toBe("a ^[x ^[z]. w] v");
    });

    // Today: "a ^[x\ny .^[z] w] v".
    it.fails("the punctuation rule leaves a nested one in a multi-line inline footnote's body alone", () => {
        expect(footnoteAfterPunctuation("a ^[x\ny ^[z]. w] v")).toBe("a ^[x\ny ^[z]. w] v");
    });

    it("control: Convert inline to normal on one line does not convert the nested one on its own", () => {
        const out = convert(["a ^[x ^[z] w] v"]);
        expect(out.join("\n")).not.toMatch(/\[\^\d+\]: z$/m);
    });

    // Today the second line becomes "y [^1] w] v", with a "[^1]: z" definition below.
    it.fails("Convert inline to normal does not convert the nested one out of a multi-line inline footnote's body", () => {
        const lines = ["a ^[x", "y ^[z] w] v"];
        const out = convert(lines);
        expect(out.slice(0, 2)).toEqual(lines);
        expect(out.join("\n")).not.toMatch(/\[\^\d+\]: z$/m);
    });
});
