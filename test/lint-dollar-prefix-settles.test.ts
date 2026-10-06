import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../src/linting/linter";

// Found by CI on 2026-10-04 (the property "lint is idempotent for every
// document and option combo" in test/properties.test.ts, seed 1744452817):
// a note whose footnote prefix holds a "$", with dollar amounts in its
// text, needed two lints to settle when named footnotes are renumbered.
// The first lint left the "[^1]" under the frontmatter as it was and gave
// "[^note]" the number "a$1"; the second then made them "a$1" and "a$2".
// Change any one of the three (the "$" in the prefix, the dollar amounts,
// the renumbering of a named footnote) and one lint settles it.

const OPTIONS: LintOptions = {
    fixPunctuation: false,
    placement: "after",
    fixLazyDefinitions: false,
    moveDefinitionsToBottom: false,
    reindex: true,
    reindexOptions: { renumberNamedFootnotes: true, nameNumberedFootnotes: false },
    removeOrphanedReferences: false,
    removeOrphanedDefinitions: true,
    mergeDuplicateDefinitions: false,
    orphanSafePrefix: "",
    applyNotePrefix: true,
    sectionHeading: "",
};

const NOTE = "---\nfootnote-prefix: a$\n---\n[^1]\n\n$5 or $6 [^note] alpha";

describe("a footnote prefix holding a dollar sign, in a note with dollar amounts", () => {
    it("one lint prefixes and numbers every footnote in reading order", () => {
        expect(lintFootnotes(NOTE, OPTIONS)).toBe("---\nfootnote-prefix: a$\n---\n[^a$1]\n\n$5 or $6 [^a$2] alpha");
    });

    it("a second lint changes nothing", () => {
        const once = lintFootnotes(NOTE, OPTIONS);
        expect(lintFootnotes(once, OPTIONS)).toBe(once);
    });
});
