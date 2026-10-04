import { describe, expect, it } from "vitest";

import { readNote } from "../src/parsing/note-reading";

// Second-press navigation for the inline-footnote hotkey: when the cursor
// is inside a ^[...] the command moves it just past the closing bracket
// instead of inserting another footnote. Which inline footnote holds the
// caret is the note reading's to say (NoteReading.inlineNoteAt, the
// runtime swap, steps 2 and 3, 2026-10-03), so these pin it on one-line
// notes: the exit position, or null when the cursor isn't inside an
// inline footnote (including unclosed ones - nothing to exit past).

/** Where the second press puts a caret at `ch` of the one-line note `line`: just past the inline footnote holding it, or null. */
function exit(line: string, ch: number): number | null {
    const note = readNote([line]).inlineNoteAt(0, ch);
    return note === null ? null : note.close + 1;
}

describe("the inline footnote at the caret, and where the second press exits to", () => {
    //             0123456789012345
    const LINE = "word^[note] more"; // ^=4 [=5 content 6-9 ]=10

    it("exits from inside the content to just past the closing bracket", () => {
        expect(exit(LINE, 8)).toBe(11);
    });

    it("exits from right after the opening bracket", () => {
        expect(exit(LINE, 6)).toBe(11);
    });

    it("exits from directly before the closing bracket", () => {
        expect(exit(LINE, 10)).toBe(11);
    });

    it("exits from between the caret and the bracket", () => {
        expect(exit(LINE, 5)).toBe(11);
    });

    it("does nothing when the cursor is already past the footnote", () => {
        expect(exit(LINE, 11)).toBeNull();
    });

    it("does nothing when the cursor is on or before the caret", () => {
        expect(exit(LINE, 4)).toBeNull();
        expect(exit(LINE, 0)).toBeNull();
    });

    it("exits an empty just-inserted footnote", () => {
        // "a^[]b": the first press leaves the cursor at ch 3, between [ and ]
        expect(exit("a^[]b", 3)).toBe(4);
    });

    it("matches the footnote the cursor is actually in", () => {
        //           0123456789012
        const two = "a^[x] b^[y] c";
        expect(exit(two, 3)).toBe(5);
        expect(exit(two, 9)).toBe(11);
        expect(exit(two, 6)).toBeNull();
    });

    it("steps over nested balanced brackets like markdown links", () => {
        //            0         1
        //            0123456789012345678
        const link = "x^[see [a](b) end]!";
        expect(exit(link, 5)).toBe(18);
    });

    it("ignores escaped brackets inside the content", () => {
        //           0123456789
        const esc = "a^[b \\] c] d"; // the \] at 5-6 doesn't close it
        expect(exit(esc, 4)).toBe(10);
    });

    it("does nothing inside an unclosed inline footnote", () => {
        expect(exit("a^[unclosed", 5)).toBeNull();
    });

    it("does not treat a [^1] reference reference as an inline footnote", () => {
        expect(exit("a[^1]b", 3)).toBeNull();
    });
});
