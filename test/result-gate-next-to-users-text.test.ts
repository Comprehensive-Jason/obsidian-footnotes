import { describe, expect, it } from "vitest";

import { EditIntent, judgeEdit } from "../src/editor/result-gate";

// Check 5 of the result gate next to the user's own text (a cut takes it
// out, a paste writes it in): a line beside it may come to start a list,
// quote, or paragraph it carried on before, or carry on one it started,
// because that is what taking out or writing in the lines next to it
// means, in any editor (hunt 2026-10-08, cycle 6, cluster Z19). It must
// still keep its blocks, and a line that is not next to the user's text
// gets no such leeway.

/** Whether the gate passes `before` turned into `after` by an action meaning `intent`. */
const passes = (before: string, after: string, intent: EditIntent) => judgeEdit(before.split("\n"), after.split("\n"), intent).pass;

/** The whole of line `line` with its line break, as a stretch of the note. */
const wholeLine = (line: number) => ({ from: { line, ch: 0 }, to: { line: line + 1, ch: 0 } });

describe("a line next to text the user cut or pasted", () => {
    it("passes a cut of a list's first item, with its footnote, that leaves the next item to start the list", () => {
        expect(passes("- a[^1]\n- b\n\n[^1]: one", "- b\n", { removedText: [wholeLine(0)], removed: ["1"] })).toBe(true);
    });

    it("passes a cut of a quote's first line that leaves the next line to start the quote", () => {
        expect(passes("> a[^1]\n> b\n\n[^1]: one", "> b\n", { removedText: [wholeLine(0)], removed: ["1"] })).toBe(true);
    });

    it("passes a paste of a list item above a list's first item, which then carries the list on", () => {
        expect(passes("- a\n- c\n\n[^9]: x", "- b[^1]\n- a\n- c\n\n[^9]: x\n[^1]: one", { insertedText: [wholeLine(0), wholeLine(5)] })).toBe(true);
    });

    it("refuses a paste of a paragraph above '2. second': '2.' cannot interrupt a paragraph, so the item joins it (rule B5)", () => {
        expect(passes("2. second\n3. third\n\n[^9]: x", "Text[^1] here.\n2. second\n3. third\n\n[^9]: x\n[^1]: one", { insertedText: [wholeLine(0), wholeLine(5)] })).toBe(false);
    });
});

describe("a line that is not next to the user's text", () => {
    it("refuses a change that makes a list item carry on the list above it (two lists joined around a moved definition, rule B9)", () => {
        expect(passes("1. Mix\n\n[^a]: by hand\n\n1. Bake[^a].", "1. Mix\n\n1. Bake.[^a]\n\n[^a]: by hand", { footnotesMoved: true })).toBe(false);
    });

    it("refuses the first item's removal when the action does not say it is the user's text", () => {
        expect(passes("- a[^1]\n- b\n\n[^1]: one", "- b\n", { removed: ["1"] })).toBe(false);
    });
});
