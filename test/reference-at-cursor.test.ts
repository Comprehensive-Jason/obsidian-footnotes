import { describe, expect, it } from "vitest";

import { readNote } from "../src/parsing/note-reading";

// The "inside a reference" rule shared by both navigation checks, aligned
// with the inline-footnote definition (issue #49): the caret counts as on
// a reference only strictly INSIDE its brackets. A caret immediately after
// the closing bracket - or immediately before the opening one - is
// outside, so the hotkey inserts a consecutive footnote there instead of
// jumping to the existing footnote's definition. The note reading answers
// it (NoteReading.referenceAt, the runtime swap, step 3, 2026-10-03).

/** The name of the reference holding column `ch` of the one-line note `line`, or null. */
const at = (line: string, ch: number): string | null => readNote([line]).referenceAt(0, ch)?.name ?? null;

describe("the reference at the caret", () => {
    //             012345678901234
    const LINE = "bravo[^1] rest"; // reference at 5-8

    it("finds the reference when the caret is inside the brackets", () => {
        expect(at(LINE, 7)).toBe("1");
    });

    it("finds the reference with the caret just inside the opening bracket", () => {
        expect(at(LINE, 6)).toBe("1");
    });

    it("finds the reference with the caret just before the closing bracket", () => {
        expect(at(LINE, 8)).toBe("1");
    });

    it("regression #49: caret right AFTER the closing bracket is outside", () => {
        expect(at(LINE, 9)).toBeNull();
    });

    it("caret right before the opening bracket is outside", () => {
        expect(at(LINE, 5)).toBeNull();
    });

    it("between two adjacent references counts as outside of both", () => {
        //              0123456789
        const two = "a[^1][^2]b"; // references at 1-4 and 5-8
        expect(at(two, 5)).toBeNull();
    });

    it("picks the reference the caret is actually inside among several", () => {
        const two = "a[^1][^2]b";
        expect(at(two, 3)).toBe("1");
        expect(at(two, 7)).toBe("2");
    });

    it("returns null on a line with no references", () => {
        expect(at("plain text", 3)).toBeNull();
    });
});
