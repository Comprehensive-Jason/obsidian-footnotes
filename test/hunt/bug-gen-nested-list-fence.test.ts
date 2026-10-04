// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 3 of 3 tests were red there and carry it.fails.
import { describe, expect, it } from "vitest";

import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { readNote } from "../../src/parsing/note-reading";

// What a user sees: a fenced code block inside a NESTED list item
// ("- - ```" or "1. 1. ```") is not detected. The code inside counts as
// live prose (autonumbering skips numbers the code only happens to
// contain), and the intended closer line OPENS a phantom fence that
// swallows the rest of the note - protection exactly inverted, the
// bug-list-item-fence pattern one container level deeper.
//
// Root cause: scanDocument's fence-opener check strips ONE list marker
// from the line, then tries the fence pattern on what is left; for a
// nested item what is left carries a SECOND marker. Same composition
// failure as the pinned bug-gen-fence-in-quote-in-list ("- > ```"), with
// a list in place of the quote: that pin covers the container pair it
// names, this is the neighboring pair a fix must also compose.
//
// Ground truth: micromark parses "fake[^99]" as code inside the nested
// item's fence (the indented variant, where the content reaches the inner
// item's margin).

const DOC = "- - ```\n    fake[^99]\n    ```\nafter[^1]";

describe("a fence inside a nested list item is protected", () => {
    it("code inside the nested fence reserves no number", () => {
        expect(computeNextFootnoteNumber(DOC)).toBe(2);
    });

    it("the fence lines are protected and the tail is live", () => {
        expect(readNote(DOC.split("\n")).protectedLines).toEqual([true, true, true, false]);
    });

    it("move-to-bottom works below the nested fence", () => {
        const doc = "- - ```\n    fake[^99]\n    ```\npara[^1]\n\n[^1]: def\n\ntail";
        expect(moveFootnoteDefinitionsToBottom(doc)).toBe(
            "- - ```\n    fake[^99]\n    ```\npara[^1]\n\ntail\n\n[^1]: def",
        );
    });
});
