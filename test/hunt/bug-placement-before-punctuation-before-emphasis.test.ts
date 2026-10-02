import { describe, expect, it } from "vitest";

import { endOfWordOffset } from "../../src/editor/cursor-motion";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// BUG (annoyance): with footnote placement "before", punctuation followed
// directly by bold or highlight markup makes the reference flip sides on
// every lint, and a press lands after the punctuation.
//
// What the user would see: the line reads "这是句子[^1]。**重点**内容",
// which is already the "before" shape. The lint moves the reference to
// "这是句子。[^1]**重点**内容", and the next lint moves it back, so every
// lint on save rewrites the line. Pressing the footnote key in "这是句子。
// **重点**内容" puts the reference after the "。", against the setting.
// "word.==hi==" in English behaves the same.
//
// Hunt 2026-10-02, round 2, lens placement. Cluster L1.
//
// Source of truth: manual sheet 16 and the README ("before" gives
// "句子[^1]。"), the rule's own idempotence claim
// (test/footnote-placement.test.ts, "so the rule is idempotent"), and the
// rule that a pressed reference is already lint-clean.
//
// Cause: referenceLandingAfter's "before" branch judges what follows a
// punctuation run by one character (isWordCharAt(text, runEnd + 1)), while
// the generic branch judges an emphasis run ("**", "==", "~~", "__") as a
// whole. So "。**重点**" reads as "punctuation, then a real closer", the
// walk steps over the "。" and stops in front of the bold opener.

describe("before: punctuation glued to an emphasis opener", () => {
    it.fails("lint under before leaves 这是句子[^1]。**重点**内容 as it is", () => {
        // Today: "这是句子。[^1]**重点**内容".
        expect(footnoteAfterPunctuation("这是句子[^1]。**重点**内容", "before")).toBe("这是句子[^1]。**重点**内容");
    });

    it.fails("the landing walk stops in front of the 。 when a bold opener follows", () => {
        expect(endOfWordOffset("这是句子。**重点**内容", 2, "before")).toBe(4);
        expect(endOfWordOffset("word.**bold** x", 2, "before")).toBe(4);
    });
});
