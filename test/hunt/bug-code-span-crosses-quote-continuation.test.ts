// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 3 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16: Reading view renders the two quoted lines as one code span (probed); the search now follows the paragraph's own quote depth.
import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// The scanner's cross-line code-span search stops at every line that
// STARTS a construct, because a construct ends the paragraph the span
// lives in: a fence, a heading, a rule, a blockquote marker (cycle 1
// pinned: "a `code\n> quoted" - the quote starts, the paragraph ends,
// the span dies unclosed).
//
// But a line whose ">" CONTINUES an already-open quote at the same depth
// is no construct: the quote's paragraph runs on, and a code span opened
// on the previous quoted line closes right there. CommonMark reads
// "> `code\n> span`" as blockquote > paragraph > one inlineCode node -
// verified against micromark for this hunt.
//
// The scanner stops at the ">" anyway, so the span never crosses and the
// [^1] inside it reads as a LIVE reference. That is text inside a code
// span, which Jason's 2026-08-10 ruling calls untouchable: it reserves a
// footnote number, it counts for reindex, and with `Delete orphaned
// references` ON the lint cuts it OUT of the code span.
//
// What the user sees: the code span in their blockquote renders
// correctly, but the plugin treats its [^1] as a footnote - the next
// real footnote skips a number, and the destructive lint setting edits
// the code.
//
// Source of truth: CommonMark's lazy paragraph continuation inside a
// blockquote via micromark as run for this hunt + the cycle-1 pin for
// the quote-STARTS case (test/hunt's code-span blockquote coverage).
//
// Settings involved: `Delete orphaned references` (the destructive
// half), the default numbering and reindex for the rest.

const doc = "> `code[^1]\n> span` tail\n\nuse[^2]\n\n[^2]: def";

function liveReferenceNames(markdown: string): string[] {
    const lines = markdown.split("\n");
    const names: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const occurrence of readNote(lines).referencesOn(i)) {
            names.push(occurrence.name);
        }
    }
    return names;
}

describe("a code span across quoted lines at the same depth", () => {
    it("crosses: the [^1] inside it is dead code, not a reference", () => {
        expect(liveReferenceNames(doc)).toEqual(["2"]);
    });

    it("reserves no footnote number", () => {
        expect(computeNextFootnoteNumber("> `code[^1]\n> span` tail")).toBe(1);
    });

    it("orphan deletion never cuts text out of the code span", () => {
        expect(removeOrphanedFootnoteReferences("> `code[^1]\n> span` tail")).toBe(
            "> `code[^1]\n> span` tail",
        );
    });

    it("control: a code span still never crosses a quote that STARTS after it (cycle-1 pin)", () => {
        expect(liveReferenceNames("a `code[^1]\n> quoted\nspan` tail")).toEqual(["1"]);
    });
});
