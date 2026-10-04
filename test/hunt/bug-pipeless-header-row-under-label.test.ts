// Imported from the glm-cycle-10 hunt of 2026-09-16 (OpenCode worktree); rewritten to the probed reading 2026-09-16.
// PROBED 2026-09-16 (GLM hunt cycle 10, Reading view): the rows of one table agree on the leading pipe. "a | b" over "--- | ---" is a table (under a label it is a separate table, as the piped form is), "a | b" over "| --- | --- |" is paragraph text everywhere (under a label, all of it is the footnote's lazy body), "| a | b |" over "--- | ---" is paragraph text too, and a row written the other way ends a table. GLM's own fixture mixed the styles, so its claim was refuted as written and confirmed for the consistent form; the table reader now judges the style, and the block walker and the quoted walker ask the reader instead of counting pipes.
import { readNote } from "../../src/parsing/note-reading";
import { describe, expect, it } from "vitest";

import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";

// Scenario: pipe runs under a footnote definition's label, with and
// without leading pipes:
//
//     [^1]: body          [^1]: body
//     a | b               a | b
//     | --- | --- |       --- | ---
//     c | d               c | d
//
// Reading view (probed 2026-09-16): the left form renders ONE footnote
// "body a | b | --- | --- | c | d" and no table, since the header row
// and the delimiter row disagree on the leading pipe; the right form
// renders the footnote "body" and a separate two-row table, exactly as
// the fully piped form does. So the rule is not GFM's "outer pipes are
// optional" but "the rows of one table agree on the leading pipe": a
// piped header over a pipe-less delimiter is text too, and a body row
// written the other way ends the table.
//
// What the user saw before the fix: the block walker counted pipes
// itself, so it read "| --- | --- |" as a table row and tore the left
// form's footnote in half (the move stranded the pipe lines), while the
// table reader marked the mixed rows as a table and the reader-driven
// alerts and caret guards treated prose as a table.

const ctx = (doc: string) => {
    const lines = doc.split("\n");
    const reading = readNote(lines);
    const masked = [...readNote(lines).maskedLines()];
    const starts = readNote(lines).labelLines;
    return { lines, reading, masked, starts };
};

describe("pipe runs under a definition label: the rows of a table agree on the leading pipe", () => {
    const mixed = ["text[^1]", "", "[^1]: body", "a | b", "| --- | --- |", "c | d"].join("\n");
    const consistent = ["text[^1]", "", "[^1]: body", "a | b", "--- | ---", "c | d"].join("\n");

    it("a pipe-less header over a piped delimiter is no table: every line is the footnote's body", () => {
        const { lines } = ctx(mixed);
        expect(readNote(lines).tableRowLines).toEqual([false, false, false, false, false, false]);
        expect(readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([{ name: "1", start: 2, end: 5 }]);
        expect(moveFootnoteDefinitionsToBottom(mixed)).toBe(mixed);
        expect(removeOrphanedFootnoteDefinitions("[^1]: body\na | b\n| --- | --- |\nc | d")).toBe("");
    });

    it("a pipe-less header over a pipe-less delimiter is a table of its own under the label", () => {
        const { lines } = ctx(consistent);
        expect(readNote(lines).tableRowLines).toEqual([false, false, false, true, true, true]);
        expect(readNote(lines).blocks.map(({ name, start, end }) => ({ name, start, end }))).toEqual([{ name: "1", start: 2, end: 2 }]);
        expect(moveFootnoteDefinitionsToBottom(consistent)).toBe(
            ["text[^1]", "", "a | b", "--- | ---", "c | d", "", "[^1]: body"].join("\n"),
        );
        expect(removeOrphanedFootnoteDefinitions("[^1]: body\na | b\n--- | ---\nc | d")).toBe(
            "a | b\n--- | ---\nc | d",
        );
    });

    it("a piped header over a pipe-less delimiter is no table either", () => {
        expect(readNote(["| a | b |", "--- | ---", "| 1 | 2 |"]).tableRowLines).toEqual([false, false, false]);
    });

    it("a body row written the other way ends the table, and the label under it is lazy", () => {
        // "| a | b |", "| --- | --- |", "c | d", "[^2]: two": the table has
        // one row, "c | d" is prose after it, and "2: two" renders as text
        expect(readNote(["| a | b |", "| --- | --- |", "c | d"]).tableRowLines).toEqual([true, true, false]);
        expect(readNote(["a | b", "--- | ---", "| 1 | 2 |"]).tableRowLines).toEqual([true, true, false]);
        const { lines, starts } = ctx("| a | b |\n| --- | --- |\nc | d\n[^2]: two\n\nsee[^2]");
        expect(starts[3]).toBe(false);
        expect(lazyDefinitionLabelNames(lines)).toEqual(["2"]);
    });

    it("a consistent pipe-less table cannot interrupt a paragraph, like any table", () => {
        expect(readNote(["prose", "a | b", "--- | ---", "c | d"]).tableRowLines).toEqual([false, false, false, false]);
    });

    it("inside a quote the same rule ends or carries on the quoted definition", () => {
        const table = ctx("> [^1]: body\n> a | b\n> --- | ---\n\ntext[^1]");
        expect((readNote(table.lines).labelOn(0)?.end ?? 0)).toBe(0);
        const text = ctx("> [^1]: body\n> a | b\n> | --- | --- |\n\ntext[^1]");
        expect((readNote(text.lines).labelOn(0)?.end ?? 0)).toBe(2);
    });

    it("control: the fully piped table under a label stays a table of its own", () => {
        const piped = ["text[^1]", "", "[^1]: body", "| a | b |", "| --- | --- |", "| c | d |"].join("\n");
        expect(moveFootnoteDefinitionsToBottom(piped)).toBe(
            ["text[^1]", "", "| a | b |", "| --- | --- |", "| c | d |", "", "[^1]: body"].join("\n"),
        );
        expect(removeOrphanedFootnoteDefinitions("[^1]: body\n| a | b |\n| --- | --- |\n| c | d |")).toBe(
            "| a | b |\n| --- | --- |\n| c | d |",
        );
    });
});
