import { describe, expect, it } from "vitest";

import { endOfWordForSelection, endOfWordOffset, startOfWordOffset } from "../../src/editor/cursor-motion";

// BUG (wrong output): in Persian and in Devanagari scripts, a press lands
// in the middle of a word instead of after it.
//
// What the user would see: the Persian word "می\u200Cخواهم" ("I want") is
// written with an invisible zero-width non-joiner (U+200C) inside it, and
// the Hindi half form "क्\u200Dषण" with an invisible zero-width joiner (U+200D).
// Readers see one word each. With "insert at end of word" on (the
// default), a press after the first letter writes the reference at the
// joiner, splitting the word in two: "می[^1]\u200Cخواهم". Selecting part of
// such a word for a footnote stops at the joiner the same way. (In these
// comments the invisible joiners are written as their escapes, \u200C and
// \u200D, so they can be seen; the test strings use the same escapes.)
//
// Hunt 2026-10-02, round 3, lens gram-off. Cluster G3.
//
// Source of truth: Unicode's word-boundary rules (UAX #29), where both
// joiners are Word_Break=Extend and never end a word, and CodeMirror's own
// EditorState.wordAt, the function Obsidian's editor.wordAt calls: it reads
// both words whole (checked in the hunt probe). The plugin's own comment
// says its walk matches "the grapheme-aware `wordAt`".
//
// Cause: isWordCp in src/editor/cursor-motion.ts counts letters, numbers,
// marks, and "_" as word characters. The joiners are format characters
// (\p{Cf}), not marks, so every word walk stops at them.

// "می\u200Cخواهم": MEEM, FARSI YEH, ZERO WIDTH NON-JOINER, KHAH, WAW, ALEF, HEH, MEEM
const persian = "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645";
// "بروم" ("I go"), the next word of the sentence
const nextWord = "\u0628\u0631\u0648\u0645";
// "क्\u200Dषण": KA, VIRAMA, ZERO WIDTH JOINER, SSA, NNA (a half form inside one word)
const hindi = "\u0915\u094D\u200D\u0937\u0923";

describe("the word walks cross a joiner inside a word", () => {
    it.fails("a press on a Persian sentence lands after the word, not between its halves", () => {
        const line = `${persian} ${nextWord}`;
        // caret after the first letter of the first word
        // Today: 2, at the non-joiner
        expect(endOfWordOffset(line, 1, "after")).toBe(persian.length);
    });

    it.fails("the end-of-word walk crosses the ZWNJ inside a Persian word", () => {
        // Today: 2
        expect(endOfWordOffset(persian, 1, "none")).toBe(persian.length);
    });

    it.fails("the selection end walk crosses the ZWNJ inside a Persian word", () => {
        // Today: 2
        expect(endOfWordForSelection(persian, 1, "before")).toBe(persian.length);
    });

    it.fails("the start-of-word walk crosses the ZWNJ inside a Persian word", () => {
        // Today: 3, just after the non-joiner
        expect(startOfWordOffset(persian, 5)).toBe(0);
    });

    it.fails("the end-of-word walk crosses a ZWJ inside a Devanagari word", () => {
        // Today: 2, at the joiner
        expect(endOfWordOffset(hindi, 1, "none")).toBe(hindi.length);
    });
});
