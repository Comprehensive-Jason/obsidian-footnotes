// Imported from the Kimi K3 cycle 4 hunt of 2026-09-16 (OpenCode worktree); 3 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";

import { readNote } from "../../src/parsing/note-reading";

// A code span that opens on a definition's label line and closes several
// lines later keeps every line in between dead (Reading view renders the
// whole stretch as one span, manual sheet 11 B30 2026-09-16; the scanner
// protects the no-backtick lines in full through startsInCode). The
// definition block owns all of it, the way it owns a comment, math, or
// fence region one of its lines opens: the footnote's body reads "a `code
// more [^2] fake span`" with the [^2] dead inside the code.
//
// findDefinitionBlocks absorbs startsInComment, startsInMath, and
// startsInFence lines, but NOT startsInCode lines: a protected line that
// carries no backtick ends the block at the label. So move-to-bottom packs
// the label line alone, leaving the span's body lines behind, and reindex
// swaps the label alone between definition slots. Either way the label
// leaves its body behind; with the "`code" opener gone from its old spot,
// the stranded lines re-read as live text and the fake [^2] wakes up.
//
// What the user sees: after a lint, their footnote's body is split - the
// definition at the bottom ends mid-sentence with a literal backtick, and
// the paragraph where the definition used to be now shows a superscript
// [^2] that was code before. The next lint's orphan alert names [^2], and
// with `Delete orphaned references` ON a later lint deletes it - user text
// destroyed across two lints. Conservation (no live text lost) is broken.
//
// Source of truth: manual sheet 11's B30 ruling (a wrapped code span is
// ONE span to Reading view; the reference inside it is dead) + the block
// walker's own absorb rule for regions a definition's lines open (Sol bug
// #3, hunt 2026-08-25), which startsInCode lines belong to.
//
// Settings involved: `Move definitions to the bottom` ON (the default);
// the full lint shows the same split.

const doc = "x[^1] para\n\n[^1]: a `code\nmore [^2] fake\nspan`\n\ntail";

const blockOf = (text: string, name: string) => {
    const lines = text.split("\n");
    return readNote(lines).blocks.find((b) => b.name === name);
};

describe("a definition whose code span crosses a column-0 no-backtick line", () => {
    it("the block owns the span's protected interior lines (startsInCode absorbed like the other regions)", () => {
        const block = blockOf(doc, "1");
        expect(block && [block.start, block.end]).toEqual([2, 4]);
    });

    it("move-to-bottom keeps the footnote's body together", () => {
        const moved = moveFootnoteDefinitionsToBottom(doc);
        expect(moved).toContain("[^1]: a `code\nmore [^2] fake\nspan`");
    });

    it("the linted note keeps the [^2] inside the span dead (no live text woke up)", () => {
        const out = lintFootnotes(doc, {});
        const lines = out.split("\n");
        const masked = [...readNote(lines).maskedLines()];
        expect(masked.some((line) => line.includes("[^2]"))).toBe(false);
    });

    it("control: the label line alone moves when the span stays on one line", () => {
        const oneLiner = "x[^1] para\n\n[^1]: a `code` fine\n\ntail";
        expect(moveFootnoteDefinitionsToBottom(oneLiner)).toBe("x[^1] para\n\ntail\n\n[^1]: a `code` fine");
    });

    it("control: a comment region's interior lines DO travel with the block (the Sol bug #3 rule)", () => {
        const withComment = "x[^1] para\n\n[^1]: a <!--\nmore [^2] fake\n-->\n\ntail";
        expect(blockOf(withComment, "1")).toMatchObject({ start: 2, end: 4 });
    });
});
