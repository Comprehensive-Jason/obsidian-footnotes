import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";

// BUG (wrong output): when a footnote is defined twice, once at the top
// level and once later in a quote or a list item, the lint moves the
// top-level copy below the other one, which changes the text the
// footnote shows.
//
// What the user would see: their note has "[^d]: column zero first" and,
// further down, "> [^d]: quoted last". Obsidian shows the last
// definition, "quoted last". After a lint with the default settings, the
// top-level copy has moved to the bottom of the note, below the quote,
// and the footnote now shows "column zero first". The same happens with
// a copy in a list item, with Merge duplicate definitions on (the merge
// refuses the name, and the move still flips it), and with reindexing
// alone, which reorders the top-level copy past the quoted one. The
// duplicate alert speaks about the name, but says nothing about the lint
// having just swapped which copy shows.
//
// Hunt 2026-10-05, round 1, lens properties. Cluster PR1. Found by the
// property "with every deletion and merge off, every live reference
// shows the same text before and after the lint" (seed 386966423); the
// reindex test is its shrunk counterexample.
//
// Source of truth: Obsidian shows the LAST definition of a name (its
// footnote transform visits every node in document order, so a later
// copy overwrites an earlier one; commit 9e36e9c; pin
// bug-carry-quoted-duplicate-first). Ruling 1, option a, 2026-10-03: a
// copy in a quote or list item never moves.
//
// Cause: move-to-bottom and reindex move or reorder the top-level
// definitions, while the quoted or in-item copy stays where it is.
// Neither checks whether a moved copy passes a copy of the same name
// that stays.
//
// Fixed (2026-10-05): both rules take the definitions they may move from
// movedDefinitions in rewrite-document.ts, which leaves out every copy of a
// name that also has a copy staying put.

describe("a top-level definition and a quoted or in-item copy of the same name", () => {
    it("the default lint keeps the quoted copy (the last) as the one Obsidian renders", () => {
        const before = "Text[^d].\n\n[^d]: column zero first\n\n> [^d]: quoted last\n\nMore text.";
        const after = lintFootnotes(before, {});
        // Today: "Text.[^d]\n\n> [^d]: quoted last\n\nMore text.\n\n[^d]: column zero first".
        // The top-level copy is now the last one, and the footnote reads "column zero first".
        expect(after.indexOf("[^d]: column zero first")).toBeLessThan(after.indexOf("> [^d]: quoted last"));
    });

    it("the same with merge on (the merge refuses the name, the move still flips it)", () => {
        const before = "Text[^d].\n\n[^d]: column zero first\n\n> [^d]: quoted last\n\nMore text.";
        const after = lintFootnotes(before, { mergeDuplicateDefinitions: true });
        expect(after.indexOf("[^d]: column zero first")).toBeLessThan(after.indexOf("> [^d]: quoted last"));
    });

    it("an in-item copy: the default lint keeps it the last one", () => {
        const before = "Text[^d].\n\n[^d]: column zero first\n\n- [^d]: item last\n\nMore text.";
        const after = lintFootnotes(before, {});
        // Today: the top-level copy lands below the list item.
        expect(after.indexOf("[^d]: column zero first")).toBeLessThan(after.indexOf("- [^d]: item last"));
    });

    it("reindex alone (move-to-bottom off) swaps the top-level copy past the quoted one (the property's shrunk counterexample)", () => {
        const before = "[^42]: alpha\n\nalpha[^1].\n\n> quoted[^42]\n> [^42]: a quoted definition\n\n[^1]: sees [^1]";
        const after = lintFootnotes(before, {
            fixPunctuation: false,
            fixLazyDefinitions: true,
            moveDefinitionsToBottom: false,
            reindex: true,
            reindexOptions: { renumberNamedFootnotes: false, nameNumberedFootnotes: false },
        });
        // Reindex renames [^42] to [^2]. Before the lint, it showed "a quoted
        // definition". Today the top-level "[^2]: alpha" block is swapped into
        // the last slot, below the quote: "[^1]: sees [^1]\n\nalpha[^1].\n\n>
        // quoted[^2]\n>\n> [^2]: a quoted definition\n\n[^2]: alpha".
        expect(after.indexOf("[^2]: alpha")).toBeLessThan(after.indexOf("> [^2]:"));
    });
});
