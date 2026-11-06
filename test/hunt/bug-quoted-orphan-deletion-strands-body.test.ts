import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";

// Scenario: an orphaned definition inside a blockquote, with an indented
// body line under its label, and that body line cites another footnote.
// The orphaned-definition rule used to cut the label line only, and the
// body line left behind changed meaning: it stopped being part of a
// definition and became quoted indented code. Its reference died with it,
// so the footnote it was keeping alive was an orphan on the next pass and
// was deleted too, one lint later, with nothing to connect the two.
//
// Hunt: 2026-09-13
// Lens: the two orphan rules (attack-surface row 10).
//
// Source of truth: the GFM reference parser vendored in this repo
// (mdast-util-gfm-footnote). Before the cut, the indented quote line parses
// as a paragraph inside footnoteDefinition "9", holding a live
// footnoteReference "b". So the body is the definition's, and Obsidian's
// Reading view agrees: a quoted definition owns its continuation lines
// (verified 2026-09-16).
//
// The fix (2026-09-16): the rule gives a quoted definition the same block
// a column-0 definition gets, label and continuation together
// (quotedDefinitionEnd). The consequence follows the rule's own contract,
// "a definition only an orphan's body references dies with it": the
// quoted orphan and "[^b]" go in ONE call, exactly as the column-0 twin of
// the same note does, and a second run has nothing left to do. Nothing is
// stranded and nothing dies a lint later.
//
// Settings: "Delete orphaned definitions" on.

const QUOTED = "para.\n\n> [^9]: stray\n>\n>     body cites[^b]\n\n[^b]: bee";
const QUOTED_NO_BARE_MARKER = "para.\n\n> [^9]: stray\n>     body cites[^b]\n\n[^b]: bee";
const COLUMN_ZERO_TWIN = "para.\n\n[^9]: stray\n\n    body cites[^b]\n\n[^b]: bee";

const rulesOff = {
    fixPunctuation: false,
    moveDefinitionsToBottom: false,
    reindex: false,
    fixLazyDefinitions: false,
};

describe("deleting a quoted orphaned definition takes its body with it", () => {
    it("the quoted orphan and the definition only its body cites go together, like the column-0 twin", () => {
        const once = removeOrphanedFootnoteDefinitions(QUOTED);
        expect(once).toBe(removeOrphanedFootnoteDefinitions(COLUMN_ZERO_TWIN));
        expect(once).toBe("para.");
        expect(removeOrphanedFootnoteDefinitions(once)).toBe(once);
    });

    it("the same without the bare quote marker between the two lines", () => {
        const once = removeOrphanedFootnoteDefinitions(QUOTED_NO_BARE_MARKER);
        expect(once).toBe("para.");
        expect(removeOrphanedFootnoteDefinitions(once)).toBe(once);
    });

    it("linting twice with only this rule on changes nothing the second time", () => {
        const options = { ...rulesOff, removeOrphanedDefinitions: true };
        const once = lintFootnotes(QUOTED, options);
        expect(once).not.toContain("body cites");
        expect(lintFootnotes(once, options)).toBe(once);
    });

    it("and neither does linting twice with the default rules on", () => {
        const options = { removeOrphanedDefinitions: true };
        const once = lintFootnotes(QUOTED, options);
        expect(once).not.toContain("body cites");
        expect(lintFootnotes(once, options)).toBe(once);
    });
});

describe("the boundary: deletions that change nothing around them", () => {
    it("an unquoted orphaned definition goes and nothing else follows it", () => {
        const doc = "text[^1]\n\n[^9]: stray\n\n[^1]: used";
        const once = removeOrphanedFootnoteDefinitions(doc);
        expect(once).toBe("text[^1]\n\n[^1]: used");
        expect(removeOrphanedFootnoteDefinitions(once)).toBe(once);
    });

    it("a quoted orphaned definition with no body goes whole", () => {
        expect(removeOrphanedFootnoteDefinitions("para.\n\n> [^9]: stray")).toBe("para.");
    });

    // Changed 2026-11-06 (hunt cycle 10), reversing the older ruling that the lazy
    // line goes with the label, for data loss (pin spec-orphan-cut-leaves-lazy-lines).
    it("a quoted definition's lazy continuation line stays when the label goes, and so does the quoted text after a blank", () => {
        const doc = "para.\n\n> [^9]: stray\n> and more of it\n\n> a quote of its own";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe("para.\n\n> and more of it\n\n> a quote of its own");
    });

    it("a quoted definition ends at the next quoted label", () => {
        const doc = "x[^a]\n\n> [^9]: stray\n> [^a]: kept";
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe("x[^a]\n\n> [^a]: kept");
    });
});
