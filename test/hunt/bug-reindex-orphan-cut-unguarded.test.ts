import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";

// BUG (data loss on a path no setting reached; low priority): Reindex's
// own orphan deletion could delete a line of indented code.
//
// What the user would have seen: nothing, since the settings tab never
// turned this path on (the settings never set keepOrphanedDefinitions).
// Code that called reindexFootnotes with keepOrphanedDefinitions: false,
// the property tests among it, got a note with the indented code line
// "    [^b]: code now" gone. The lint idempotence property hit it too
// (seed 693972902: an orphan between two list items that the orphan rule
// refused to cut, cut anyway by reindex, which joined the lists).
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L7.
//
// Source of truth: the orphan rule's guard (cutDefinitionsIfClean in
// remove-orphaned-definitions.ts) refuses a cut that would change how
// Obsidian reads a line it keeps (linesReadDifferently), and leaves this
// same note alone.
//
// Cause: reindexOnce, with keepOrphanedDefinitions false, cut the
// orphans with definitionCuts and removeLineRanges directly, without the
// linesReadDifferently guard. "[^1]: lazy in quote" was lazy text inside
// the quote of "> [^3]: orphan". With that quote cut away, the line
// became a definition of its own, and the indented code under it became
// a definition held inside it. The next pass deleted that held definition
// as an orphan.
//
// Fixed by removing the option and reindex's own deletion (the triage's
// recommendation; no setting reached it, and main.ts migrates the old
// saved setting to Delete orphaned definitions). The orphan rule is now
// the only route, so the test runs the note through the lint with that
// rule on.

describe("the lint's orphan deletion, with reindex on", () => {
    const note = ["Text[^1].", "", "> [^3]: orphan", "[^1]: lazy in quote", "", "    [^b]: code now", "", "[^1]: last"].join("\n");

    it("keeps the indented code line", () => {
        const options = { removeOrphanedDefinitions: true, fixLazyDefinitions: false };
        const once = lintFootnotes(note, options);
        expect(once).toContain("    [^b]: code now");
        expect(lintFootnotes(once, options)).toBe(once);
    });

    it("reindex on its own never deletes a definition", () => {
        expect(reindexFootnotes(note)).toContain("> [^2]: orphan");
    });
});
