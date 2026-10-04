import { describe, expect, it } from "vitest";

import { lineDiffChanges, lineMapper } from "../src/editor/document-diff";

// Jason's report (the feature-round sheet, 2026-09-24): the same note in two panes, lint
// from one, and the other pane's caret dropped to the top. The live half
// (Obsidian's delayed copy into the other pane, the restore after it) is
// the smoke test "lint leaves a second pane on the same note where it
// was"; this pins the pure half, where a caret line lands after a rewrite.

function mapper(before: string, after: string): (line: number) => number {
    return lineMapper(lineDiffChanges(before, after), before);
}

describe("lineMapper: where another pane's caret line sits after a rewrite", () => {
    it("a line renumbered in place is still the same line", () => {
        const map = mapper("a[^x] b\nc\n\n[^x]: d", "a[^1] b\nc\n\n[^1]: d");
        expect([0, 1, 2, 3].map(map)).toEqual([0, 1, 2, 3]);
    });

    it("lines below an inserted line shift down by one, lines above stay", () => {
        const map = mapper("a\nb\nc", "a\nnew\nb\nc");
        expect([0, 1, 2].map(map)).toEqual([0, 2, 3]);
    });

    it("a deleted line lands on the line before the deletion, and the lines below it shift up", () => {
        const map = mapper("a\nb\nc", "a\nc");
        expect([0, 1, 2].map(map)).toEqual([0, 0, 1]);
    });

    it("never answers past the last line of the new text, or below the first", () => {
        const map = mapper("a\nb\nc\nd", "a");
        expect([0, 1, 2, 3, 9].map(map)).toEqual([0, 0, 0, 0, 0]);
    });

    it("with nothing changed, every line is itself", () => {
        const map = lineMapper([], "a\nb");
        expect([0, 1, 7].map(map)).toEqual([0, 1, 7]);
    });
});
