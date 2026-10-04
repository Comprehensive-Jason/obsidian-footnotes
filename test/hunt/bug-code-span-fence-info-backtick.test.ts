// Imported from the Kimi K3 cycle 5 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// CommonMark 4.5: the info string of a BACKTICK fence may not itself
// contain a backtick, so "``` `x`" is not a fence at all - it is
// paragraph text. A code span opened on the line above therefore closes
// inside it: "para `code [^1]" over "``` `x`" is one paragraph holding
// one code span "code [^1]\n``` " followed by literal "x`" (verified
// with the micromark oracle). Reading view renders cross-line code spans
// as one span the same way (sheet 11, B30).
//
// The scanner's paragraphGoesOn walk, which decides whether a code span
// may close on a later line, stops at any line matching
// /^ {0,3}(`{3,}|~{3,})/ - the fence SHAPE, without isFenceOpener's
// backtick-in-info check. So the walk stops at "``` `x`", the span is
// read as never closing, and the "[^1]" inside it comes back LIVE: the
// orphan alert names it, the numbered command reserves its number,
// reindex renumbers it, and `Delete orphaned references` cuts it out of
// what Reading view shows as a code span.
//
// What the user sees: with `Delete orphaned references` ON, the lint
// deletes "[^1]" out of a code span - live code text destroyed - or, with
// the toggle off, the lint alert insists a reference inside a code span
// has no definition.
//
// Source of truth: CommonMark 4.5 (backtick fence info strings) +
// micromark oracle output below + sheet 11's B30 (Reading view renders
// the cross-line span as one).
//
// Settings involved: none for the scan; the orphan alert/deletion
// inherits it.

const doc = "para `code [^1]\n``` `x`";

describe("a code span closing inside a fence-shaped line with a backtick in its info", () => {
    it("the masked twin blots the span across both lines", () => {
        const lines = doc.split("\n");
        const masked = [...readNote(lines).maskedLines()];
        // line 0's tail is code, line 1 is code through the closing "`"
        expect(masked[0]).toBe("para \0\0\0\0\0\0\0\0\0\0");
        // "``` `x`": the span closes at the single backtick (index 4),
        // so five characters are blotted and "x`" stays (the pin's
        // original expectation miscounted by one)
        expect(masked[1]).toBe("\0\0\0\0\0x`");
    });

    it("the reference inside the span is dead", () => {
        const lines = doc.split("\n");
        expect(readNote(lines).referencesOn(0)).toEqual([]);
    });

    it("control: a real fence line does stop the span (the reference stays live)", () => {
        const lines = ["para `code [^1]", "```"];
        const masked = [...readNote(lines).maskedLines()];
        expect(masked[0]).toBe("para `code [^1]");
        expect(readNote(lines).referencesOn(0).map((o) => o.name)).toEqual(["1"]);
    });

    it("control: a tilde fence may hold a backtick in its info, so it does stop the span", () => {
        const lines = ["para `code [^1]", "~~~ `x`"];
        const masked = [...readNote(lines).maskedLines()];
        expect(masked[0]).toBe("para `code [^1]");
    });
});
