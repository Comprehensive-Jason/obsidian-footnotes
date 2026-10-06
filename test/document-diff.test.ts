import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { lineDiffChanges } from "../src/editor/document-diff";

// Jason's manual lint pass (2026-09-11): linting unfolded every folded
// heading and list in the note, and the caret jumped to one of the linted
// spots. Both came from how the lint wrote its result back: one edit
// spanning from the first changed character to the last, which replaced
// every untouched fold and every caret position in between.
//
// lineDiffChanges turns a before/after pair into the smallest set of
// line-range edits, so the editor keeps its folds and maps the caret
// through untouched text unchanged.

/** Apply `changes` (offsets into `before`, applied in order) and return the result. */
function apply(before: string, changes: { from: number; to: number; text: string }[]): string {
    let out = "";
    let copied = 0;
    for (const change of changes) {
        out += before.slice(copied, change.from) + change.text;
        copied = change.to;
    }
    return out + before.slice(copied);
}

describe("lineDiffChanges", () => {
    it("an unchanged document needs no edit", () => {
        expect(lineDiffChanges("a\nb\nc", "a\nb\nc")).toEqual([]);
    });

    it("one changed line in the middle touches only the characters that changed", () => {
        const before = "alpha\nbravo\ncharlie\ndelta";
        const after = "alpha\nbravo!\ncharlie\ndelta";
        const changes = lineDiffChanges(before, after);
        expect(changes).toEqual([{ from: "alpha\nbravo".length, to: "alpha\nbravo".length, text: "!" }]);
        expect(apply(before, changes)).toBe(after);
    });

    it("a swap inside a line leaves the caret's column alone past the swap", () => {
        // the punctuation rule's edit: only "[^1]." -> ".[^1]" is rewritten,
        // so a caret after it keeps its column (Jason's report, 2026-09-11)
        const before = "word[^1]. keep the caret HERE";
        const after = "word.[^1] keep the caret HERE";
        expect(lineDiffChanges(before, after)).toEqual([{ from: 4, to: 9, text: ".[^1]" }]);
    });

    it("two separate edits become two hunks, leaving the lines between them alone", () => {
        const before = "one[^2]\nkeep\nkeep\nkeep\n\n[^2]: two\n[^1]: one";
        const after = "one[^1]\nkeep\nkeep\nkeep\n\n[^1]: two\n[^2]: one";
        const changes = lineDiffChanges(before, after);
        // one edit for the first line, then one for each of the two
        // renumbered definition lines: neighbouring rewritten lines are
        // edits of their own, so a caret on either keeps its place (hunt
        // 2026-10-06 cycle 3, cluster D3, pin bug-caret-merged-rewrite-runs)
        expect(changes).toHaveLength(3);
        expect(changes[0]).toEqual({ from: "one[^".length, to: "one[^2".length, text: "1" });
        expect(changes[1].from).toBeGreaterThanOrEqual("one[^2]\nkeep\nkeep\nkeep\n\n".length);
        expect(apply(before, changes)).toBe(after);
    });

    it("a definition moved to the bottom is a deletion hunk and an insertion hunk", () => {
        const before = "a[^1]\n\n[^1]: def\n\ntail";
        const after = "a[^1]\n\ntail\n\n[^1]: def";
        const changes = lineDiffChanges(before, after);
        expect(apply(before, changes)).toBe(after);
        // the "a[^1]" line is untouched by any hunk
        expect(changes.every((c) => c.from >= "a[^1]\n".length)).toBe(true);
    });

    it("reproduces the after text for any pair of documents", () => {
        const lineArb = fc.constantFrom("", "a", "b[^1]", "[^1]: one", "[^2]: two", "    cont", "# H", "tail");
        const docArb = fc.array(lineArb, { maxLength: 12 }).map((lines) => lines.join("\n"));
        fc.assert(
            fc.property(docArb, docArb, (before, after) => {
                const changes = lineDiffChanges(before, after);
                expect(apply(before, changes)).toBe(after);
                // hunks are ordered and never overlap
                for (let i = 1; i < changes.length; i++) {
                    expect(changes[i].from).toBeGreaterThanOrEqual(changes[i - 1].to);
                }
            }),
            { numRuns: 300 },
        );
    });
});
