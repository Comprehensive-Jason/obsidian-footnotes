import { describe, expect, it } from "vitest";

import { lintFootnotes, type LintOptions } from "../../src/linting/linter";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { readNote } from "../../src/parsing/note-reading";

// BUG (data loss, in an unnatural shape): under "Before punctuation", two
// moves on one line that each turn a footnote into the other kind, in
// opposite directions, both go through, and a later lint can delete the
// footnote text.
//
// What the user would see: with footnote placement set to before
// punctuation, "e = mc^.[^1] and [.^[note]" is saved. The lint writes
// "e = mc^[^1]. and [^[note].": "^[^1]" is now an inline footnote whose
// text is "^1", so [^1] has no reference left, and "[^[note]" is now a
// reference named "[note" where the inline footnote was. With "Delete
// orphaned definitions" on, the next save deletes "[^1]: the source"; with
// "Delete orphaned references" on, the first save deletes "[^[note]", and
// "note" is gone.
//
// An "inline footnote" is "^[text]", a footnote written in place.
//
// Hunt 2026-10-06, cycle 4, lens press. Cluster P3.
//
// Origin: pre-existing.
//
// Source of truth: the punctuation rule's promise that a move never
// changes what a footnote is (the fixed pin
// bug-placement-before-changes-footnote-kind, 57fecdb, for one change at a
// time).
//
// Cause: the check in src/linting/rules/footnote-after-punctuation.ts
// that a move leaves every footnote it moves a footnote counts references
// and inline footnotes per line (57fecdb). One reference that became an
// inline footnote and one inline footnote that became a reference keep
// both counts the same, so the check lets the line through.

/** The live references and inline footnotes on one line, as Obsidian reads them. */
function live(lines: string[], line = 0) {
    const r = readNote(lines);
    return {
        refs: r.referencesOn(line).map((o) => o.name),
        inline: r.inlineNotesOn(line).map((n) => lines[line].slice(n.open, n.close + 1)),
    };
}

describe("two kind changes on one line pass the count check", () => {
    // Now: refs ["[note"] and the inline footnote "^[^1]".
    it("before: 'mc^.[^1] and [.^[note]' keeps [^1] a reference and ^[note] an inline footnote", () => {
        const doc = "e = mc^.[^1] and [.^[note]\n\n[^1]: a";
        const out = footnoteAfterPunctuation(doc, "before");
        expect(live(out.split("\n"))).toEqual(live(doc.split("\n")));
    });

    // Now: "e = mc^[^1]. and [^[note]." with the definition deleted.
    it("two lints (before, delete orphaned definitions on), as on two saves, keep footnote 1's text", () => {
        const doc = "e = mc^.[^1] and [.^[note]\n\n[^1]: the source";
        const opts: LintOptions = { placement: "before", removeOrphanedDefinitions: true };
        const out = lintFootnotes(lintFootnotes(doc, opts), opts);
        expect(out).toContain("the source");
    });

    // Now: "e = mc^[^1]. and ." with "note" deleted.
    it("one lint (before, delete orphaned references on) keeps the inline footnote's text", () => {
        const doc = "e = mc^.[^1] and [.^[note]\n\n[^1]: the source";
        const out = lintFootnotes(doc, { placement: "before", removeOrphanedReferences: true });
        expect(out.split("\n")[0]).toContain("note");
    });
});
