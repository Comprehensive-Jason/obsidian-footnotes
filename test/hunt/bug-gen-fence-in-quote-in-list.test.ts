// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 3 of 3 tests were red there and carry it.fails.
import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { readNote } from "../../src/parsing/note-reading";

// What a user sees: in a note with a fenced code block inside a blockquote
// inside a list item ("- > ```"), the fence is not detected: code inside it
// is treated as live text, so the next "Insert footnote" skips numbers the
// code only happens to contain (here it mints [^100] instead of [^2]), and
// a definition-shaped line inside the code is listed as a real definition.
//
// Root cause: scanDocument's fence-opener check strips a list marker from
// the line and then tries the fence pattern on what is left - but what is
// left can still carry a blockquote marker ("> ```"), which the pattern
// does not accept. The container walk composes quote-inside-list the other
// way ("> - ```" works, and "> > ```" works), so this one nesting order
// falls through. A mutation of the container-fence class one level deeper
// than the pins (bug-list-item-fence covered "- ```").

describe("a fence inside a blockquote inside a list item is protected", () => {
    const doc = "- > ```\n  > code[^99]\n  > ```\nafter[^1]";

    it("code inside the nested fence reserves no number", () => {
        expect(computeNextFootnoteNumber(doc)).toBe(2);
    });

    it("the fence interior and closer are protected lines", () => {
        expect(readNote(doc.split("\n")).protectedLines).toEqual([true, true, true, false]);
    });

    it("orphan deletion does not cut code text out of the nested fence", () => {
        // the missed fence leaves the quoted label-shaped code line looking
        // like a live (quoted, C22) definition; nothing references "9", so
        // reindex's drop-orphans deletes the code line
        const withLabel = "- > ```\n  > [^9]: fake\n  > ```\nreal[^1]\n\n[^1]: real";
        expect(reindexFootnotes(removeOrphanedFootnoteDefinitions(withLabel))).toBe(withLabel);
    });
});
