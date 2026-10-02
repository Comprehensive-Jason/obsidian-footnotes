import { describe, expect, it } from "vitest";

import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// spec question: under the "before" placement, should the lint put a
// reference that sits after French high punctuation back on the word, in
// front of the space French typography puts before the "?"?
//
// French typography puts a space (often a no-break space, U+00A0, or a
// narrow no-break space, U+202F) BEFORE ; : ! and ?, and the note call
// glued to the word, ahead of that space: "Vraiment[^1] ?".
//
// What it does now: a press on "Vraiment" already lands there,
// "Vraiment[^1] ?". But the lint, moving a hand-typed "Vraiment ?[^1]"
// back in front of the "?", leaves the call after the space:
// "Vraiment [^1]?". The call is glued to the "?" instead of the word, and
// the press and the lint disagree on the same sentence.
// What a user might expect: the lint gives the same result as the press,
// "Vraiment[^1] ?".
// Why it is a question and not a bug: the lint does exactly what the
// "before" placement promises, putting the reference in front of the
// punctuation it follows. Hopping back over a space as well is a new rule,
// and whether it should apply to every space or only the no-break spaces
// French uses is Jason's call.
//
// Hunt 2026-10-02, round 3, lens gram-off. Cluster G9.
//
// Source of truth: French typographic convention (a no-break space before
// high punctuation), the placement setting's docstring, which names French
// among the "before" conventions (FootnotePlacement), and the press's own
// landing as the plugin's other reading of the same sentence.

describe("spec question: French spacing before high punctuation under 'before'", () => {
    it.fails("the lint puts a hand-typed call after ' ?' (no-break space) back on the word", () => {
        // Today: "Vraiment\u00A0[^1]?"
        expect(footnoteAfterPunctuation("Vraiment\u00A0?[^1]\n\n[^1]: n", "before")).toBe(
            "Vraiment[^1]\u00A0?\n\n[^1]: n",
        );
    });
});
