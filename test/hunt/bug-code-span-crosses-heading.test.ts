// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 3 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16: Reading view keeps the heading's reference live (probed); a run opened in a heading never looks ahead.
import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { readNote } from "../../src/parsing/note-reading";

// A code span lives inside ONE paragraph: CommonMark lets it wrap across
// the lines of a paragraph, and the plugin matches (sheet 11's B30,
// 2026-09-16). A HEADING is not a paragraph - it is a leaf block whose
// inline content ends with the line. A backtick run opened in a heading
// has no later line to close on; it is a literal backtick.
//
// The scanner's cross-line span search (closesAhead in markdown-scan.ts)
// stops at every construct that ENDS a paragraph, but it never asks
// whether the OPENER's own line can carry a span across lines at all.
// From "# `code" it finds the closer on the next line and masks the
// heading's tail plus the next line's opener as one code span - so the
// [^1] inside the heading is dead text to the plugin.
//
// Verified against micromark: "# `code[^1]\nspan` tail\n\n[^1]: def"
// parses as heading(text "`code", footnoteReference#1) + paragraph +
// footnoteDefinition#1 - the reference in the heading is LIVE.
//
// What the user sees: their footnote reference renders fine in Reading
// view, but the plugin's half of the world disagrees - the definition is
// an orphan to the linter (alerted, or DELETED with `Delete orphaned
// definitions` ON), and with another numbered footnote in the note,
// reindex renames the definition while the heading's reference stays
// put, silently retargeting it.
//
// Source of truth: CommonMark's code-span rule (a span wraps only within
// one paragraph; a heading is a leaf block) via micromark as run for
// this hunt + sheet 11's B30 (the paragraph case the plugin matches).
//
// Settings involved: `Delete orphaned definitions` (the destructive
// half), the default reindex and alerts for the rest.

const doc = "# `code[^1]\nspan` tail\n\nuse[^2]\n\n[^1]: def\n[^2]: other";

function liveReferenceLines(markdown: string): number[] {
    const lines = markdown.split("\n");
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (readNote(lines).referencesOn(i).length > 0) out.push(i);
    }
    return out;
}

describe("a backtick run opened inside a HEADING", () => {
    it("never closes on a later line: the reference in the heading is live", () => {
        // before the fix the plugin masked the heading's tail into a
        // phantom code span running on into the next line
        const lines = doc.split("\n");
        expect(readNote(lines).regionOpenAt(1)).toBe(false);
        expect(readNote(lines).maskedLine(0)).toBe(lines[0]);
    });

    it("the heading's reference binds its definition (no orphan, no renumber)", () => {
        expect(liveReferenceLines(doc)).toEqual([0, 3]);
    });

    it("reserves its number", () => {
        expect(computeNextFootnoteNumber("# `code[^1]\nspan` tail")).toBe(2);
    });

    it("control: the same span inside a PARAGRAPH still wraps (sheet 11's B30)", () => {
        expect(liveReferenceLines("a `code[^1]\nspan` tail")).toEqual([]);
    });
});
