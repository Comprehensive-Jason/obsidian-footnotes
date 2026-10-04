import { describe, expect, it } from "vitest";

import { definitionLabelIn } from "../../src/parsing/label-shapes";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";

// Bug #5 (2026-08-11 review, Kimi): BlockquotePrefix didn't consume each
// ">" marker's optional trailing space between iterations, so ">    > x"
// (4 spaces: one marker space + 3 indent - a legal depth-2 quote) parsed
// as depth 1 for definitionLabelIn while blockquoteDepth said depth 2.
// Definitions behind such prefixes were invisible to navigation and
// orphan handling. Ground-truthed in the live reading view 2026-08-11
// (probes P7/P8/P10): 4 spaces between markers nests, 5 does not (the
// second ">" becomes indented-code text inside the quote).

describe("wide-gap nested quote markers (bug-wide-gap-quote-markers)", () => {
    it("a 4-space gap still reaches the definition label", () => {
        expect(definitionLabelIn(">    > [^1]: x")).toEqual({
            quoted: true,
            nameStart: 9,
            nameEnd: 10,
            labelEnd: 12,
        });
    });

    it("a 5-space gap is not a nested quote - no label", () => {
        expect(definitionLabelIn(">     > [^1]: x")).toBeNull();
    });

    it("orphan removal sees the wide-gap quoted definition", () => {
        const doc = "use[^7]\n\n>    > [^7]: seven";
        expect(removeOrphanedFootnoteReferences(doc)).toBe(doc);
    });

    it("behind a 5-space gap the definition is code text and the reference IS an orphan", () => {
        const doc = "use[^7]\n\n>     > [^7]: seven";
        expect(removeOrphanedFootnoteReferences(doc)).toBe(
            "use\n\n>     > [^7]: seven",
        );
    });
});
