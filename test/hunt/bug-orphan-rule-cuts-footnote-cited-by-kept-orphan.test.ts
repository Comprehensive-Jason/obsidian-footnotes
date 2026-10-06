import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import {
    orphanedFootnoteDefinitionNames,
    removeOrphanedFootnoteDefinitions,
} from "../../src/linting/rules/remove-orphaned-definitions";

// BUG (wrong output): Delete orphaned definitions keeps an orphan whose cut
// would change how the lines around it read, but still cuts a footnote
// that only that kept orphan cites, so the kept orphan is left citing a
// footnote with no definition.
//
// What the user would see: an unreferenced "[^a]: outer, citing[^b]" sits
// between two lists, and "[^b]: bee" is cited only from [^a]'s text. The
// lint keeps [^a] (cutting it would join the two lists into one) and its
// alert names it, but "[^b]: bee" is deleted, so in Reading view [^a]'s
// text shows a bare "[^b]" and the footnote's text is gone for good.
//
// Found while fixing hunt 2026-10-05 round 2, cluster C2 (the carry
// group closed the same gap in planCut with its "stillUnused" rule,
// 3145b1e).
//
// Source of truth: ADR 0002 (docs/adr/0002-never-silent-lint.md, the lint
// leaves what it cannot clean up and says so) and the orphan rule's own
// promise to keep a definition whose removal would change the reading,
// together with its rule that a definition it keeps keeps alive the
// footnotes its body cites (remove-orphaned-definitions.ts, the note at
// the top of the file).
//
// Cause: removeOrphanedFootnoteDefinitions tries the whole chain [a, b]
// at once, which the reading guard refuses, then tries each block on its
// own and cuts the first that goes cleanly, [b], without asking whether a
// block that stays still cites it.

const NOTE = ["Text.", "", "- one", "", "[^a]: outer, citing[^b]", "", "- two", "", "[^b]: bee"].join("\n");

describe("the orphan rule and a footnote cited only by an orphan it keeps", () => {
    it("keeps the footnote the kept orphan cites", () => {
        expect(removeOrphanedFootnoteDefinitions(NOTE)).toBe(NOTE);
    });

    it("the lint keeps it too, and the alert still names the kept orphan", () => {
        const options = { removeOrphanedDefinitions: true, moveDefinitionsToBottom: false, reindex: false };
        expect(lintFootnotes(NOTE, options)).toContain("[^b]: bee");
        expect(orphanedFootnoteDefinitionNames(NOTE)).toEqual(["a"]);
    });

    it("control: with nothing around the orphan to change, the whole chain goes", () => {
        const plain = ["Text.", "", "[^a]: outer, citing[^b]", "", "[^b]: bee"].join("\n");
        expect(removeOrphanedFootnoteDefinitions(plain)).toBe("Text.");
    });

    it("control: an unrelated orphan elsewhere in the note still goes", () => {
        const withStray = `${NOTE}\n[^z]: stray`;
        expect(removeOrphanedFootnoteDefinitions(withStray)).toBe(NOTE);
    });
});
