import { describe, expect, it } from "vitest";

import { verifyLiveFootnoteInsertion } from "../src/editor/insertion-liveness";

// Direct pins for the shared born-dead verdict (extracted 2026-08-25).
// The call sites' behavior is pinned elsewhere (command-properties,
// mutation-hardening-creation, selection-to-footnote); these hit the
// helper's OWN contract - each refusal case below kills a mutant the
// 2026-08-25 scoped Stryker run showed surviving when only the call
// sites were tested: the definition must start at EXACTLY the given
// label line AND claim every seeded body line, and EVERY reference must
// parse at EXACTLY its anchor under EXACTLY the given name.
//
// Since 2026-10-03 the verdict reads the note exactly as the transaction
// leaves it (planDefinitionAppend works that out), so each case below
// spells out that final note: "alpha bravo", "", "tail" with "[^1]"
// written after "alpha" and "\n\n[^1]: " appended after "tail", the
// label on line 4. The cases are the ones the change-list version had.

const FINAL = ["alpha[^1] bravo", "", "tail", "", "[^1]: "];

describe("verifyLiveFootnoteInsertion", () => {
    it("a live reference with its live definition verifies", () => {
        expect(
            verifyLiveFootnoteInsertion({
                lines: FINAL,
                anchors: [{ line: 0, ch: 5 }],
                footnoteId: "1",
                definitionLabelLine: 4,
            }),
        ).toBe("live");
    });

    it("refuses when no definition block starts at the given label line", () => {
        expect(
            verifyLiveFootnoteInsertion({
                lines: FINAL,
                anchors: [{ line: 0, ch: 5 }],
                footnoteId: "1",
                // the label really sits on line 4 - a block that merely
                // ENDS past line 3 must not count as starting there
                definitionLabelLine: 3,
            }),
        ).toBe("dead");
    });

    it("a seeded continuation line claimed by the block verifies", () => {
        expect(
            verifyLiveFootnoteInsertion({
                lines: ["alpha[^1] bravo", "", "tail", "", "[^1]: one", "    two"],
                anchors: [{ line: 0, ch: 5 }],
                footnoteId: "1",
                definitionLabelLine: 4,
                definitionBodyExtraLines: 1,
            }),
        ).toBe("live");
    });

    it("refuses when a seeded body line falls OUT of the block", () => {
        expect(
            verifyLiveFootnoteInsertion({
                // the second body line is a heading, which no definition
                // block can claim - the block ends on the label line
                lines: ["alpha[^1] bravo", "", "tail", "", "[^1]: one", "# two"],
                anchors: [{ line: 0, ch: 5 }],
                footnoteId: "1",
                definitionLabelLine: 4,
                definitionBodyExtraLines: 1,
            }),
        ).toBe("dead");
    });

    it("refuses a reference landing inside inline code", () => {
        expect(
            verifyLiveFootnoteInsertion({
                lines: ["alpha `c[^1]ode` bravo", "", "tail", "", "[^1]: "],
                anchors: [{ line: 0, ch: 8 }],
                footnoteId: "1",
                definitionLabelLine: 4,
            }),
        ).toBe("dead");
    });

    it("one dead landing refuses the lot - EVERY reference must be live", () => {
        expect(
            verifyLiveFootnoteInsertion({
                lines: ["alpha[^1] bravo", "`co[^1]de x`", "tail", "", "[^1]: "],
                anchors: [
                    { line: 0, ch: 5 },
                    { line: 1, ch: 3 },
                ],
                footnoteId: "1",
                definitionLabelLine: 4,
            }),
        ).toBe("dead");
    });

    it("refuses when the occurrence does not sit EXACTLY at its anchor", () => {
        expect(
            verifyLiveFootnoteInsertion({
                // a leading space: the reference parses one column past the
                // anchor, which is not the insertion promised
                lines: ["alpha [^1] bravo", "", "tail", "", "[^1]: "],
                anchors: [{ line: 0, ch: 5 }],
                footnoteId: "1",
                definitionLabelLine: 4,
            }),
        ).toBe("dead");
    });

    it("refuses when the parsed name is not the promised id", () => {
        expect(
            verifyLiveFootnoteInsertion({
                lines: ["alpha[^2] bravo", "", "tail", "", "[^1]: "],
                anchors: [{ line: 0, ch: 5 }],
                footnoteId: "1",
                definitionLabelLine: 4,
            }),
        ).toBe("dead");
    });

    it("a live reference that landed inside another definition is nested, not live (ADR 0001)", () => {
        // the empty line under "[^1]: one" was filled by the reference, so
        // it reads as footnote 1's lazy continuation, prose and all (hunt
        // 2026-10-02, pin bug-press-blank-line-under-definition-nests)
        expect(
            verifyLiveFootnoteInsertion({
                lines: ["Text[^1] here.", "", "[^1]: one", "[^2]", "More prose.", "", "[^2]: "],
                anchors: [{ line: 3, ch: 0 }],
                footnoteId: "2",
                definitionLabelLine: 6,
            }),
        ).toBe("nested");
    });
});
