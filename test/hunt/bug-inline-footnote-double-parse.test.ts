import { describe, expect, it } from "vitest";

import { readNote } from "../../src/parsing/note-reading";
import { applyFootnotePrefix } from "../../src/linting/rules/apply-footnote-prefix";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";

// Scenario: "inline ^[^literal]" is ONE inline footnote with content
// "^literal" per the repo's own inlineFootnoteSpanAt, but
// footnoteReferenceMatches matches the inner [^literal] as a regular reference -
// reindex and applyFootnotePrefix rewrite inline-footnote content.
// Hunt: 2026-08-09. Lens: grammar.
// Root cause: the regular-reference regex double-parses the interior of an
// inline footnote; nothing excludes spans already claimed by inlineFootnoteSpanAt.

describe("fixed 2026-08-10: inline footnotes are double-parsed as regular references", () => {
    it("an inline footnote is not also parsed as a regular reference", () => {
        // the note reading, since the runtime swap (step 3, 2026-10-03)
        expect(readNote(["inline ^[^literal]"]).referencesOn(0)).toEqual([]);
    });

    it("reindex leaves inline-footnote content that resembles an id untouched", () => {
        const input = "inline ^[^9] real[^7]\n\n[^7]: body";
        expect(reindexFootnotes(input)).toBe("inline ^[^9] real[^1]\n\n[^1]: body");
    });

    it("applying a prefix does not turn an inline footnote into a regular reference", () => {
        const input = "inline ^[^note] real[^1]\n\n[^1]: body";
        expect(applyFootnotePrefix(input, "p.")).toBe(
            "inline ^[^note] real[^p.1]\n\n[^p.1]: body",
        );
    });
});
