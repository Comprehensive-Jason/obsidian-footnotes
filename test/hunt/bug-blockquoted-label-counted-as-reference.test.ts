import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";

import { readNote } from "../../src/parsing/note-reading";

// BUG (review A3, Jason confirmed live 2026-09-08): footnoteReferenceMatches
// excluded a definition's own label only at COLUMN 0, so a blockquoted
// label ("> [^9]: quoted orphan") counted as a reference. Reindex's
// appearance order then handed that orphan number 1, ahead of the footnote
// the text actually uses - while the orphan alert still (correctly) named
// it as an orphan. remove-orphaned-definitions already excluded such labels
// locally; the exclusion now lives in referenceOccurrences, the one home of
// "every reference on this line", so every rule agrees.

const DOC = ["> [^9]: quoted orphan", "", "text[^5]", "", "[^5]: five"].join("\n");

describe("a blockquoted definition label is not a reference", () => {
    it("the note reading counts no label as a reference", () => {
        expect(readNote(["> [^9]: quoted orphan"]).referencesOn(0)).toEqual([]);
        // a reference INSIDE a blockquoted definition body still counts
        expect(
            readNote(["> [^9]: see[^5] too"]).referencesOn(0).map((o) => o.name),
        ).toEqual(["5"]);
    });

    it("reindex numbers the referenced footnote first and the quoted orphan after it", () => {
        expect(lintFootnotes(DOC)).toBe(
            ["> [^2]: quoted orphan", "", "text[^1]", "", "[^1]: five"].join("\n"),
        );
    });

    it("a quoted orphan cannot collide with a renumbered footnote", () => {
        // before: "> [^1]: q" kept 1 only because it was counted as the first
        // reference; with the label excluded it must still not be overwritten
        // by the renumbered live footnote
        const doc = ["> [^1]: quoted orphan", "", "text[^5]", "", "[^5]: five"].join("\n");
        const out = reindexFootnotes(doc);
        const labels = out.match(/\[\^[^\]]+\]:/g) ?? [];
        expect(new Set(labels).size).toBe(labels.length);
        expect(out).toContain("text[^1]");
        expect(out).toContain("\n[^1]: five");
    });
});
