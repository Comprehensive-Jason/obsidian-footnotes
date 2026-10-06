import { describe, expect, it } from "vitest";

import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";

// BUG (data loss on a path no setting reaches; low priority): Reindex's
// own orphan deletion can delete a line of indented code.
//
// What the user would see: nothing today, since the settings tab never
// turns this path on (linter.ts: the settings never set
// keepOrphanedDefinitions). Code that calls reindexFootnotes with
// keepOrphanedDefinitions: false, the property tests among it, gets a
// note with the indented code line "    [^b]: code now" gone.
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L7.
//
// Source of truth: the orphan rule's guard (cutDefinitionsIfClean in
// remove-orphaned-definitions.ts) refuses a cut that would change how
// Obsidian reads a line it keeps (linesReadDifferently), and leaves this
// same note alone; linter.ts's comment that both routes to deleting
// orphans "always agree".
//
// Cause: reindexOnce, with keepOrphanedDefinitions false, cuts the
// orphans with definitionCuts and removeLineRanges directly, without the
// linesReadDifferently guard. "[^1]: lazy in quote" was lazy text inside
// the quote of "> [^3]: orphan". With that quote cut away, the line
// becomes a definition of its own, and the indented code under it becomes
// a definition held inside it. The next pass deletes that held definition
// as an orphan.

describe("reindex with keepOrphanedDefinitions false", () => {
    it.fails("keeps the indented code line", () => {
        const note = ["Text[^1].", "", "> [^3]: orphan", "[^1]: lazy in quote", "", "    [^b]: code now", "", "[^1]: last"].join("\n");
        // Today: "Text[^1].\n\n[^1]: lazy in quote\n\n[^1]: last".
        expect(reindexFootnotes(note, { keepOrphanedDefinitions: false })).toContain("    [^b]: code now");
    });
});
