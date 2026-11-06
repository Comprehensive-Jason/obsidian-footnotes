import { describe, expect, it } from "vitest";

import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";

// Under Before placement, the final dot of an abbreviation like "U.S." belongs
// to the word, so the reference stays behind it (Jason's ruling, 2026-11-06,
// option E of "Abbreviation placement research 2026-11-06"). Until that ruling
// the lint turned "the U.S.[^1] law" into "the U.S[^1]. law".
//
// test/abbreviation-placement.test.ts holds the whole table and the word lists'
// behaviour.
//
// Hunt 2026-10-02, round 3, lens reg. Cluster E9.

describe("Before placement and an abbreviation's final dot (ruling 2026-11-06)", () => {
    it("the lint leaves 'U.S.[^1]' whole under before", () => {
        expect(footnoteAfterPunctuation("the U.S.[^1] law\n\n[^1]: d", "before")).toBe("the U.S.[^1] law\n\n[^1]: d");
    });

    it("the lint moves 'U.S[^1].' forward to where a press puts it", () => {
        expect(footnoteAfterPunctuation("the U.S[^1]. law\n\n[^1]: d", "before")).toBe("the U.S.[^1] law\n\n[^1]: d");
    });
});
