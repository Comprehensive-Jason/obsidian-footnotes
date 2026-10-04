import { describe, expect, it } from "vitest";

import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// BUG, data loss (hunt 2026-08-25, contexts lens; skeptic-confirmed with
// micromark ground truth): a fenced code block inside a footnote
// definition's 4-space-indented continuation is NOT protected - the
// fence-opener regex caps leading spaces at 0-3 ABSOLUTE, and unlike
// list items (which get a content-indent stack) definitions have no
// relative-indent concept. GFM parses the region as a code block (no
// footnoteCall inside), yet the scanner leaves it live, so the
// delete-orphaned-references rule EATS a "[^9]"-shaped string out of
// code - exactly the user text docs/adr/0002-never-silent-lint.md
// promises never to lose. The comment/math openers are
// indentation-INSENSITIVE in the same position (deliberately, Sol bug
// #3), which is the same root gap observed at classification level:
// same shape, same column, two different outcomes. One fix locus:
// give fences the definition-relative content-indent treatment the
// listStack already gives list items.

const FENCED_IN_CONTINUATION = [
    "[^1]: para one",
    "    ```js",
    "    var x = [^9]; // looks fenced, no [^9] definition anywhere",
    "    ```",
    "    para two",
];

describe("fences inside definition continuations", () => {
    it("orphan-reference deletion leaves the fenced [^9] alone", () => {
        const before = FENCED_IN_CONTINUATION.join("\n");
        expect(removeOrphanedFootnoteReferences(before)).toBe(before);
    });

    it("the scanner protects the fence interior like it protects a comment there", () => {
        // the HTML-comment twin of this fixture IS protected at the same
        // 4-space column (indentation-insensitive opener); the fence must
        // classify the same way
        const reading = readNote(FENCED_IN_CONTINUATION);
        expect(reading.protectedLines[2]).toBe(true);
    });
});

describe("boundaries of the definition-content fence branch (2026-08-25 mutation audit)", () => {
    it("a fence at the definition content column's +3 limit (7 spaces) still opens", () => {
        const reading = readNote([
            "[^1]: para one",
            "       ```",
            "       inside [^9]",
            "       ```",
        ]);
        expect(reading.protectedLines[2]).toBe(true);
    });

    it("a blank line between the label and the fence still absorbs the fence into the block", () => {
        const lines = [
            "[^1]: para one",
            "",
            "    ```",
            "    inside",
            "    ```",
        ];
        expect(
            readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end })),
        ).toEqual([{ name: "1", start: 0, end: 4 }]);
    });

    it("the absorb indent test anchors at line START, not any 4-space run", () => {
        // a DOC-level fence opener with one leading space and an interior
        // 4-space run must still END the block when a blank run lands on it
        const lines = ["[^1]: a", "", " ```    x", " code", " ```"];
        expect(
            readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end })),
        ).toEqual([{ name: "1", start: 0, end: 0 }]);
    });
});
