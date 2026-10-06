import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";

// Found by the fast-check idempotence property (2026-08-10), ground truth
// verified against Obsidian's metadataCache: deleting the orphaned "[^42]"
// blanks the only paragraph between a definition and an indented chunk -
// and Obsidian continues a footnote definition across ANY run of blank
// lines, so the chunk flips from indented CODE to definition CONTINUATION.
// The next lint pass then saw "[^73]" as a live (orphaned) reference and
// deleted text the first pass had promised to protect. The rule now
// refuses any deletion that changes another line's protection
// classification; such orphans stay for the user to resolve.

describe("orphan-reference deletion never re-classifies other lines", () => {
    it("refuses the deletion that would demote indented code to a continuation", () => {
        const doc = "[^1]: alpha\n\n[^42]\n\n    indented code[^73]";
        expect(removeOrphanedFootnoteReferences(doc)).toBe(doc);
    });

    it("definition deletion happens before the reference rule's guard looks", () => {
        // Reindex used to delete the shielding [^1]: alpha definition
        // AFTER the reference rule refused [^42]'s deletion because of it -
        // pass two then deleted what pass one refused. All definition
        // deletion now happens up front, in the orphan rule (reindex's own
        // deletion was removed, hunt 2026-10-05 round 2, cluster L7).
        const doc = "[^1]: alpha\n\n[^42]\n\n    indented code[^73]";
        const options = {
            fixPunctuation: false,
            moveDefinitionsToBottom: false,
            reindex: true,
            removeOrphanedReferences: true,
            removeOrphanedDefinitions: true,
        };
        const once = lintFootnotes(doc, options);
        expect(once).toContain("indented code[^73]");
        expect(lintFootnotes(once, options)).toBe(once);
    });

    it("a deletion's blank residue is re-settled within the same pass", () => {
        // "[^x]" was a paragraph of its own; deleting it leaves blank lines
        // that the NEXT pass's move-to-bottom collapsed - the pipeline now
        // re-runs move after a real deletion so pass one already emits the
        // fixed point
        const doc = "[^1]: alpha\n\n[^x]";
        const options = {
            fixPunctuation: false,
            moveDefinitionsToBottom: true,
            reindex: false,
            removeOrphanedReferences: true,
            removeOrphanedDefinitions: false,
        };
        const once = lintFootnotes(doc, options);
        expect(once).toBe("[^1]: alpha");
        expect(lintFootnotes(once, options)).toBe(once);
    });

    it("reference deletion judges the layout AFTER move-to-bottom", () => {
        // Pass one refused [^1]'s deletion because [^note]'s definition sat
        // above the code chunk - then move-to-bottom relocated that
        // definition, and pass two deleted what pass one refused. The rule
        // now runs after move, on the settled layout, so its verdict is
        // the same on every pass.
        const doc = "[^note]: alpha\n\n[^1]\n\n    indented code[^73]";
        const options = {
            fixPunctuation: false,
            moveDefinitionsToBottom: true,
            reindex: false,
            removeOrphanedReferences: true,
            removeOrphanedDefinitions: false,
        };
        const once = lintFootnotes(doc, options);
        expect(once).toContain("indented code[^73]");
        expect(lintFootnotes(once, options)).toBe(once);
    });

    it("definition deletion runs first, so a refusal can't depend on a doomed shield", () => {
        // With BOTH deletions on: [^1]: alpha is an orphaned definition and
        // [^9] an orphaned reference. References-first refused [^9] (its
        // blanking would flip the code chunk into a continuation of [^1])
        // - then definitions-first deleted [^1], and the SECOND pass could
        // delete what the first refused (idempotence property, 2026-08-10).
        // Definitions delete first, so the refusal guard judges the doc
        // that actually survives the pass.
        const doc = "[^1]: alpha\n\n[^9]\n\n    indented code[^73]";
        const options = {
            fixPunctuation: false,
            moveDefinitionsToBottom: false,
            reindex: false,
            removeOrphanedReferences: true,
            removeOrphanedDefinitions: true,
        };
        const once = lintFootnotes(doc, options);
        expect(once).toContain("indented code[^73]");
        expect(lintFootnotes(once, options)).toBe(once);
    });

    it("still deletes orphans whose removal is classification-neutral", () => {
        const doc =
            "keep[^1] drop[^9] end\n\npara\n\n    indented code[^73]\n\n[^1]: one";
        // the indented chunk is shielded by the "para" paragraph in BOTH
        // the input and the output - [^9]'s deletion changes nothing
        expect(removeOrphanedFootnoteReferences(doc)).toBe(
            "keep[^1] drop end\n\npara\n\n    indented code[^73]\n\n[^1]: one",
        );
    });
});
