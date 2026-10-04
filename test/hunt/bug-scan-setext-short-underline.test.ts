// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 2 of 3 tests were red there and carry it.fails.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

// "H\n--" is a setext level-2 heading per CommonMark (one or more dashes,
// exactly like the "=" case the code already handles for the same shape),
// so a label right under it starts a definition - but the scanner calls it
// lazy paragraph text, and the definition goes invisible to navigation,
// listing, and lint.

const startsOf = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).labelLines;
};

describe("a label under a one-or-two-dash setext underline is a definition", () => {
    it("two dashes", () => {
        expect(startsOf("H\n--\n[^1]: x")).toEqual([false, false, true]);
    });

    it("findDefinitionBlocks pairs the label with its reference", () => {
        const lines = "use[^1]\n\nH\n--\n[^1]: x".split("\n");
        expect(
            readNote(lines).blocks.map((b) => b.name),
        ).toEqual(["1"]);
    });

    it("the three-dash twin already works (control)", () => {
        expect(startsOf("H\n---\n[^1]: x")).toEqual([false, false, true]);
    });
});
