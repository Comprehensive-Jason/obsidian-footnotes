import type { EditorChange } from "obsidian";
import { describe, expect, it } from "vitest";

import { endOfWordOffset, startOfWordOffset } from "../../src/editor/cursor-motion";
import { simulateChanges } from "../../src/editor/insertion-liveness";

// spec question: should these two helpers be total functions, answering for
// any input they are handed, or is out-of-range input outside their
// contract, so that a caller who hands them nonsense gets whatever happens?
//
// Reading one, total: a helper that takes an offset or a range should cope
// with one that does not fit the text, because the offsets it is handed come
// from a live editor. A caret can be reported past the end of the text it
// belongs to: that is exactly why cellCaret exists to clamp one (sheet 06,
// 2026-09-11), and the #39 null-deref class says a stale caret must not
// crash the press that reads it. On this reading endOfWordOffset should give
// the offset back untouched, the way its twin startOfWordOffset already
// does, and simulateChanges should refuse a range whose end comes before its
// start rather than invent text.
//
// Reading two, by contract: both functions are internal helpers with one
// caller each, every caller clamps its offsets before calling, and no caller
// can build a reversed range. On this reading the current behaviour is
// nobody's problem and the cost of making them total is code that can never
// run.
//
// What the user would see today: nothing. Both are latent. No press reaches
// either function with input of this shape, so these are questions about
// what the helpers promise, not reports of something breaking.
//
// Hunt: 2026-09-13. Lens: offsets.
//
// Sorted 2026-11-05 under Jason's scope rule of 2026-10-07: reading two
// stands. Both it.fails tests were deleted, not turned into plain tests, since
// pinning a throw or nonsense text would only pin noise. Every caller hands
// these helpers a caret inside its text and a range the right way round, so no
// press reaches either shape. The controls stay.
//
// Source of truth: startOfWordOffset's own behaviour on the same input (it
// returns the offset unchanged) as the sibling contract endOfWordOffset is
// measured against; and @codemirror/state's ChangeSet, which throws on a
// range whose end is before its start, as the referee the simulation is
// written to match (test/simulate-changes-differential.test.ts uses the very
// same referee).

describe("an offset past the end of the text", () => {
    it("control: its twin startOfWordOffset gives the offset straight back", () => {
        expect(startOfWordOffset("word", 10)).toBe(10);
    });

    it("control: a negative offset is already given straight back by both", () => {
        expect(endOfWordOffset("word", -1)).toBe(-1);
        expect(startOfWordOffset("word", -1)).toBe(-1);
    });

    it("control: an offset exactly at the end of the text is fine", () => {
        expect(endOfWordOffset("word", 4)).toBe(4);
        expect(startOfWordOffset("word", 4)).toBe(4);
    });
});

describe("a change whose range runs the right way round", () => {
    const DOC = ["alpha", "bravo", "charlie"];

    it("control: the same range the right way round replaces what it covers", () => {
        const changes: EditorChange[] = [
            { from: { line: 0, ch: 1 }, to: { line: 0, ch: 4 }, text: "X" },
        ];
        expect(simulateChanges(DOC, changes).join("\n")).toBe(["aXa", "bravo", "charlie"].join("\n"));
    });
});
