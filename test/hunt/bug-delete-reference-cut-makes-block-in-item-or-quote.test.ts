import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";

// BUG (wrong output): cutting an orphaned reference can turn the line it
// leaves behind into a new block, a heading or bullet inside a list item,
// or a blockquote, and neither delete command refuses.
//
// What the user would see: a list item reads "- #[^9] tail", where "#"
// with no space after it is plain text. [^9] has no definition, and
// Delete orphaned references (or Delete footnote everywhere on [^9]) cuts
// it, leaving "- # tail", a heading inside the item. "- -[^9] tail"
// becomes "- - tail", a nested bullet. "[^9]> q" is a paragraph; the cut
// leaves "> q", a blockquote, at column 0, under a paragraph line (a quote
// interrupts a paragraph), and inside a list item ("- [^9]> q").
//
// Hunt 2026-10-02, round 3, lens reg. Cluster E11.
//
// Source of truth: f50d339 (Kimi cycle 4: the cut refuses when a kept line
// would turn into a heading, a rule, a bullet, an ordered item, or a
// fence) and 94f830b (the same guard for a lone "%%", a setext underline,
// an HTML tag line), whose harm is a kept line read differently;
// CommonMark 4.2 (an ATX heading needs a space after "#"), 5.1 (a block
// quote interrupts a paragraph), and 5.2 (list items).
//
// Cause: the reclassification guard's blockKind (in
// remove-orphaned-references.ts, shared with Delete footnote) strips quote
// markers before it looks at a line but not a list marker, so it never
// sees what starts inside an item. And it has no "quote" kind, so a line
// that turns into a blockquote reads as plain text both before and after.

/** The `n` lines that follow the note's first two lines, where each case puts its body. */
function keptLines(out: string, n: number): string[] {
    return out.split("\n").slice(2, 2 + n);
}

// Each case: its name, and the lines it puts in the note. Today the cut
// leaves, in order, "- # tail", "- - tail", "> q", "para" over "> q", and
// "- > q".
const cases: [string, string[]][] = [
    ["a heading inside a list item", ["- #[^9] tail"]],
    ["a bullet inside a list item", ["- -[^9] tail"]],
    ["a blockquote at column 0", ["[^9]> q"]],
    ["a blockquote under a paragraph line", ["para", "[^9]> q"]],
    ["a blockquote inside a list item", ["- [^9]> q"]],
];

describe("an orphan-reference cut never turns a kept line into a new block (inside a list item, or a blockquote)", () => {
    for (const [name, body] of cases) {
        const doc = ["top[^1]", "", ...body, "", "end", "", "[^1]: one"].join("\n");

        it(`Delete orphaned references refuses: ${name}`, () => {
            // Today: the lines listed above the cases.
            expect(keptLines(removeOrphanedFootnoteReferences(doc), body.length)).toEqual(body);
        });

        it(`Delete footnote everywhere refuses: ${name}`, () => {
            // Today: "deleted", with the same lines left behind.
            expect(deleteFootnoteEverywhere(doc, "9").kind).toBe("refused");
        });
    }

    it("control: the quoted twin of the heading is refused", () => {
        const doc = ["top[^1]", "", "> #[^9] tail", "", "end", "", "[^1]: one"].join("\n");
        expect(removeOrphanedFootnoteReferences(doc)).toBe(doc);
        expect(deleteFootnoteEverywhere(doc, "9").kind).toBe("refused");
    });
});
