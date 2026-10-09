import { describe, expect, it } from "vitest";

import {
    duplicateFootnoteDefinitionNames,
    mergeDuplicateDefinitionsRule,
    mergeDuplicateFootnoteDefinitions,
} from "../src/linting/rules/merge-duplicate-definitions";
import {
    orphanedFootnoteReferenceNames,
    removeOrphanedFootnoteReferences,
    removeOrphanedReferencesRule,
} from "../src/linting/rules/remove-orphaned-references";

// Mutation hardening for the two orphan-family rules (Stryker re-baseline
// 2026-08-12: merge-duplicate-definitions 72%, remove-orphaned-references
// 83%). The pinned scenarios in merge-duplicate-definitions.test.ts and
// orphaned-references.test.ts cover the happy shapes; what survived is the
// arithmetic AROUND them - the trailing-blank bookkeeping at the end of a
// merge, the exact width of the seam a deleted reference leaves behind, the
// direction ids fold in, and the byte-identity promise on a mixed-EOL
// no-op. These probe those boundaries directly.

describe("merging never changes the note's trailing blank lines", () => {
    it("keeps every trailing blank line the note already had", () => {
        // trailingBefore must be counted for real: a miscount (loop never
        // running, counting the wrong way, stopping one short) pops blank
        // lines the note owned
        expect(
            mergeDuplicateFootnoteDefinitions(
                "use[^d] here\n\n[^d]: one\n\n[^d]: two\n\ntail\n\n",
            ),
        ).toBe("use[^d] here\n\n[^d]: one\n    two\n\ntail\n\n");
    });

    it("never mints MORE trailing blank lines than the note had", () => {
        // cutting a duplicate that closed the note strands the blank lines
        // that used to separate it - BOTH of them: trailingAfter must be
        // counted past the first blank, or one stranded blank survives a
        // note that ended on text
        expect(
            mergeDuplicateFootnoteDefinitions("u[^d]\n\n[^d]: one\n\n\n[^d]: two"),
        ).toBe("u[^d]\n\n[^d]: one\n    two");
    });
});

describe("duplicate names fold DOWN, not up", () => {
    // "ß".toLowerCase() is "ß" but "ß".toUpperCase() is "SS" - folding the
    // wrong way makes [^ß] and [^SS] the same footnote and merges two
    // unrelated definitions into one
    const sharpS = "see[^ß] and[^SS]\n\n[^ß]: sharp\n\n[^SS]: caps";

    it("leaves definitions that only an upper-case fold would collide alone", () => {
        expect(mergeDuplicateFootnoteDefinitions(sharpS)).toBe(sharpS);
    });

    it("does not report them as duplicates either", () => {
        expect(duplicateFootnoteDefinitionNames(sharpS)).toEqual([]);
    });
});

describe("duplicateFootnoteDefinitionNames early out", () => {
    it("returns an empty list for a note with no footnote syntax at all", () => {
        expect(duplicateFootnoteDefinitionNames("plain prose, nothing here")).toEqual(
            [],
        );
    });
});

describe("the seam a deleted orphan leaves", () => {
    it("swallows a following SPACE only - never the next character", () => {
        expect(removeOrphanedFootnoteReferences("start [^9]end")).toBe("start end");
        expect(removeOrphanedFootnoteReferences("[^9]end")).toBe("end");
        // the space in front of a cut reference that punctuation follows
        // goes with it (Jason's ruling Q35, 2026-10-09, which settles D10;
        // "a ! b" until then), and the "!" still stays
        expect(removeOrphanedFootnoteReferences("a [^9]! b")).toBe("a! b");
    });

    it("takes the WHOLE run of spaces before a reference that closed the line", () => {
        expect(removeOrphanedFootnoteReferences("word  [^9]")).toBe("word");
        expect(removeOrphanedFootnoteReferences("word \t [^9]")).toBe("word");
    });
});

describe("orphan names fold DOWN, not up", () => {
    it("lists [^ß] and [^SS] as two different orphans", () => {
        expect(orphanedFootnoteReferenceNames("a[^ß] b[^SS]")).toEqual(["ß", "SS"]);
    });
});

describe("a no-op deletion pass is byte-identical", () => {
    it("keeps a mixed-EOL note exactly as typed when nothing is orphaned", () => {
        // the every() guard must really compare line by line: rewriting an
        // untouched note would flip its LF lines to CRLF
        const doc = "keep[^1] here\r\nplain line\n\n[^1]: one";
        expect(removeOrphanedFootnoteReferences(doc)).toBe(doc);
    });

    it("keeps a mixed-EOL note with no references at all as typed", () => {
        const doc = "plain line\r\nsecond line\nthird";
        expect(removeOrphanedFootnoteReferences(doc)).toBe(doc);
    });
});

describe("the rule descriptors (the settings-facing surface)", () => {
    it("merge-duplicate-definitions describes itself", () => {
        expect(mergeDuplicateDefinitionsRule.id).toBe("merge-duplicate-definitions");
        expect(mergeDuplicateDefinitionsRule.name).toBe("Merge duplicate definitions");
        expect(mergeDuplicateDefinitionsRule.description).toBe(
            "Merge every later definition of an already-defined footnote into the first one, keeping each body as a continuation line (Obsidian renders only the last definition otherwise).",
        );
        expect(
            mergeDuplicateDefinitionsRule.examples.map(
                (example) => example.description,
            ),
        ).toEqual(["A second definition merges into the first as a continuation"]);
    });

    it("remove-orphaned-references describes itself", () => {
        expect(removeOrphanedReferencesRule.id).toBe("remove-orphaned-references");
        expect(removeOrphanedReferencesRule.name).toBe("Remove orphaned references");
        expect(removeOrphanedReferencesRule.description).toBe(
            "Delete footnote references that have no definition anywhere in the note.",
        );
        expect(
            removeOrphanedReferencesRule.examples.map(
                (example) => example.description,
            ),
        ).toEqual([
            "A reference with no definition is removed",
            "A definition in any casing keeps its references",
        ]);
    });

    it("passes the note's safe prefix through to the transform", () => {
        // the option must reach the transform intact - a lost prefix
        // deletes the placeholder the user is mid-way through naming
        expect(
            removeOrphanedReferencesRule.apply("mid [^3.] naming", {
                orphanSafePrefix: "3.",
            }),
        ).toBe("mid [^3.] naming");
        // …and with no prefix given, that same placeholder IS an orphan
        expect(
            removeOrphanedReferencesRule.apply("mid [^3.] naming", {}),
        ).toBe("mid naming");
    });
});
