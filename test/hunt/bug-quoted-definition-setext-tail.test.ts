// Imported from the Kimi K3 cycle 5 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { readNote } from "../../src/parsing/note-reading";
import { describe, expect, it } from "vitest";


import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// A setext underline directly under a definition's LAZY CONTINUATION line
// pulls that line out of the footnote and makes it a heading: "[^1]: body",
// "cont", "===" renders as a footnote reading "body" plus a heading
// reading "cont" (Kimi hunt cycle 3, probed in Reading view 2026-09-16).
// The column-0 block walker knows: findDefinitionBlocks stops before a
// plain line that a setext underline follows.
//
// The QUOTED walker never got the same check. quotedDefinitionEnd happily
// absorbs "> cont" and the "> ===" under it into the quoted definition's
// extent, so every consumer of that extent disagrees with the column-0
// reading of the identical unquoted text:
//
// - Orphaned-definition deletion cuts the heading "cont" and the "==="
//   away with the label, eating text Reading view shows as a heading, not
//   as the footnote's body (the never-eat-user-text promise, ADR-0002).
// - The nesting guards (quotedDefinitionLabelAbove) refuse a footnote
//   press on the heading line, calling it "inside a definition".
// - The jump from the reference lands past the heading line.
//
// What the user sees: with `Delete orphaned definitions` ON, a quoted
// footnote nothing references is removed - and the heading below it,
// which was never part of the footnote, vanishes with it.
//
// Source of truth: the cycle-3 Reading view probe (a setext underline
// under a lazy continuation pulls that line out as a heading) + the
// plugin's own column-0 walker, which stops before such a line; the
// quoted walker is the same question and must give the same answer.
//
// Settings involved: `Delete orphaned definitions` ON for the cut; the
// walker disagreement itself needs no setting.

const quoted = ["> [^2]: body", "> cont", "> ==="];

describe("a quoted definition with a setext underline under its lazy continuation", () => {
    it("quotedDefinitionEnd stops before the underlined line, like the column-0 walker", () => {
        const starts = readNote(quoted).labelLines;
        expect(starts[0]).toBe(true);
        expect((readNote(quoted).labelOn(0)?.end ?? 0)).toBe(0);
    });

    it("orphan deletion keeps the heading", () => {
        const doc = "> [^2]: body\n> cont\n> ===\n\ntext[^1]\n\n[^1]: d";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe("> cont\n> ===\n\ntext[^1]\n\n[^1]: d");
    });

    it("control: the column-0 walker already stops before the underlined line", () => {
        const lines = ["[^2]: body", "cont", "==="];
        expect(readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([
            { name: "2", start: 0, end: 0 },
        ]);
    });

    it("control: a quoted definition with a plain lazy continuation reaches it", () => {
        const lines = ["> [^2]: body", "> cont"];
        expect(readNote(lines).labelOn(0)?.end).toBe(1);
    });
});
