import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { readNote } from "../../src/parsing/note-reading";

// Sol re-review bug #3 (2026-08-10): a definition's indented continuation
// can OPEN a protected region ("    $$" or "    <!--"); the region's
// interior is protected, and the definition-end walk stopped at it - so
// the block ended mid-region. Move-to-bottom then relocated HALF the
// definition, stranding the math body mid-document, and the moved
// fragment's unclosed "$$" swallowed the note bottom on the next pass.
// The walk now absorbs protected lines that START inside a region, which
// can only have been opened by a continuation line already in the block.

const MATH_DOC = "top[^1]\n\n[^1]: formula\n    $$\n    E = mc^2\n    $$\n\ntail";

describe("definition blocks span regions their continuations open", () => {
    it("the block runs through an embedded math region", () => {
        const lines = MATH_DOC.split("\n");
        expect(
            readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end })),
        ).toEqual([{ name: "1", start: 2, end: 5 }]);
    });

    it("move-to-bottom relocates the whole definition, math included", () => {
        expect(moveFootnoteDefinitionsToBottom(MATH_DOC)).toBe(
            "top[^1]\n\ntail\n\n[^1]: formula\n    $$\n    E = mc^2\n    $$",
        );
    });

    it("the block runs through an embedded comment region", () => {
        const doc = "x[^1]\n\n[^1]: note\n    <!--\n    hidden\n    -->\n\nafter";
        const lines = doc.split("\n");
        expect(
            readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end })),
        ).toEqual([{ name: "1", start: 2, end: 5 }]);
    });

    it("an indented continuation AFTER the math still belongs to the block", () => {
        const doc = "x[^1]\n\n[^1]: a\n    $$\n    E\n    $$\n\n    tail";
        const lines = doc.split("\n");
        const reading = readNote(lines);
        expect(
            readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end })),
        ).toEqual([{ name: "1", start: 2, end: 7 }]);
        // and the scanner keeps "    tail" a live continuation, not code
        expect(reading.protectedLines[7]).toBe(false);
    });
});
