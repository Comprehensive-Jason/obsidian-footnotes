import { describe, expect, it } from "vitest";

import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// spec question: if the placement setting goes from "after" to "before"
// and back, should the lint bring the references back where they were?
//
// What it does now: '"word".[^1] next' becomes '"word"[^1]. next' under
// "before", and stays that way when switched back to "after". The same
// for "**bold**.[^1]" and "「句子」。[^1]".
// What a user might expect: the README says "Changing the setting moves
// the references in a note the next time it is linted", and its after
// shape for a quote is '"quote".[^1]', so switching back would restore it.
// Why it is a question and not a bug: under "after", a reference right
// after a closing mark counts as already placed (AlreadyPlacedAfter,
// 5ec4b66, 2026-09-09), a ruling made so the lint does not fight the
// user's own choice in that spot. Whether a switch of the setting should
// override that is Jason's call.
//
// Hunt 2026-10-02, round 2, lens placement. Cluster L9.
//
// Source of truth: the README's placement setting and manual sheet 16
// ("before" gives '"word"[^1].').

describe("spec question: after -> before -> after returns the after shape", () => {
    for (const d of ['"word".[^1] next', "**bold**.[^1] next", "「句子」。[^1]"]) {
        it.fails(d, () => {
            const a = footnoteAfterPunctuation(d, "after");
            expect(footnoteAfterPunctuation(footnoteAfterPunctuation(a, "before"), "after")).toBe(a);
        });
    }
});
