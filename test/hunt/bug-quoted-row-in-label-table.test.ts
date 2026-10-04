// Imported from the GLM 5.3 Flash cycle 3 hunt of 2026-09-16 (OpenCode worktree); 3 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";


import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { readNote } from "../../src/parsing/note-reading";

// A table that starts ON a definition's label line ("[^1]: | a | b |")
// belongs to the footnote, its column-0 rows included (pinned in Reading
// view, cycle 3). findDefinitionBlocks absorbs those rows through
// columnZeroRow, which checks indent, labels and pipes - but not
// BLOCKQUOTE MARKERS. A quoted row ("> | c | d |") is not a column-0 row:
// a blockquote line cannot lazily continue a table (lazy continuation
// applies to paragraphs only), so in Reading view it interrupts the table
// and sits OUTSIDE the footnote, as a top-level blockquote - the same rule
// that makes the walker's own lazyContinuation reject every ">"-prefixed
// line under a definition body.
//
// The block walker swallows the quoted line anyway, so the definition
// block reaches one line past the table. The orphaned-definition rule
// then CUTS it: with `Delete orphaned definitions` on, an unreferenced
// "[^1]" takes the user's blockquote line with it - text Obsidian never
// rendered as part of the footnote, eaten by a rule whose promise is that
// only the definition goes. move-to-bottom drags the quoted line along
// too (harmless-looking, but it relocates a line that was never the
// footnote's).
//
// What the user sees: their quoted table row disappears from the note
// when the lint deletes an orphaned definition above it. ADR 0002's
// guarantee (deletion only takes what the rule names) is broken by the
// extent, not by the toggle.
//
// Source of truth: CommonMark container rules (a blockquote cannot
// lazily continue a table; at column 0 it is a top-level block outside
// the definition) + the plugin's own lazyContinuation, which rejects
// ">" lines under a definition body for exactly this reason + the
// pinned column-0-rows ruling, whose rows carry no quote markers.
//
// Settings involved: `Delete orphaned definitions` ON (the cut); the
// extent itself affects move-to-bottom at any setting.

const blocksOf = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }));
};

describe("a quoted row under a table that starts on a label line", () => {
    it("is outside the definition block", () => {
        const doc = "text\n\n[^1]: | a | b |\n| --- | --- |\n> | c | d |\n\n> quoted live";
        expect(blocksOf(doc)).toEqual([{ name: "1", start: 2, end: 3 }]);
    });

    it("orphan deletion leaves the quoted line in the note", () => {
        const doc = "text\n\n[^1]: | a | b |\n| --- | --- |\n> | c | d |\n\n> quoted live";
        const after = removeOrphanedFootnoteDefinitions(doc);
        expect(after).toContain("> | c | d |");
    });

    it("move-to-bottom does not drag the quoted line along", () => {
        const doc = "use[^1].\n\n[^1]: | a | b |\n| --- | --- |\n> | c | d |\n\ntail prose";
        const after = moveFootnoteDefinitionsToBottom(doc);
        const definitionPart = after.slice(after.indexOf("[^1]:"));
        expect(definitionPart).not.toContain("> | c | d |");
    });

    it("control: unquoted column-0 rows stay inside the block (the pinned ruling)", () => {
        const doc = "text\n\n[^1]: | a | b |\n| --- | --- |\n| c | d |";
        expect(blocksOf(doc)).toEqual([{ name: "1", start: 2, end: 4 }]);
    });
});
