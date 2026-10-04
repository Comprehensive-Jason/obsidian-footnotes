// Imported from the glm-cycle-10 hunt of 2026-09-16 (OpenCode worktree); all pins flipped green 2026-09-16 after the fix.
// RESOLVED 2026-09-16 (GLM hunt cycle 10, both alt shapes probed in Reading view: an embed and no footnote). The alt blot now finds the bracket that balances the opener.
// GLM hunt cycle 10, 2026-09-16.
//
// Scenario: an image whose ALT TEXT holds a bracketed footnote reference:
//
//     see ![alt[^1]](url)
//
//     [^1]: one
//
// What Reading view shows (probed, GLM cycle 3, recorded in
// spec-image-alt-reference.test.ts): an embed with alt "alt^1" and NO
// footnote - the alt is stringified, its reference never resolves, and no
// definition entry renders. micromark agrees (probed for this hunt: the
// document parses to <img alt="alt^1"/> and no footnote section).
//
// The scan leaves the reference LIVE. The image-alt blot in
// maskLineRegions matches an alt with /!\[([^[\]\n]*)\]\(/ - a group that
// cannot contain brackets - so an alt that CONTAINS the reference's own
// "[^1]" never matches it, and no other masking path claims the text (a
// link's "]" branch blots only the destination; the "[[" branch needs two
// opening brackets). The cycle-3 probe covered exactly the bracketed
// shape "![alt[^1]](url)" and settled it dead.
//
// What the user sees: the footnote takes a number in reindex as if it
// rendered, the missing-definition alert asks for a definition for text
// that never shows one, an alt-only reference keeps a definition alive
// under Delete orphaned definitions, and a press inside the alt text
// mints a footnote that is dead on arrival (the born-dead check reads
// the same live mask and lets it through).
//
// Source of truth: the cycle-3 Reading-view probe recorded in
// spec-image-alt-reference.test.ts + micromark 4.0 output for the exact
// document + the blot's own contract (the same file already blots a
// bracket-free alt).
//
// Settings involved: none (the scan feeds every rule and every press).

import { describe, expect, it } from "vitest";


import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { readNote } from "../../src/parsing/note-reading";

const refsOf = (doc: string): string[] => {
    const lines = doc.split("\n");
    return lines.flatMap((_, i) =>
        readNote(lines).referencesOn(i).map((o) => o.name),
    );
};

describe("an image alt that holds a bracketed reference", () => {
    it("is dead text, as the cycle-3 probe settled for the same shape", () => {
        expect(refsOf("see ![alt[^1]](url)\n\n[^1]: one")).toEqual([]);
    });

    it("same for a reference with padding text around it in the alt", () => {
        expect(refsOf("![see [^1] here](u)\n\n[^1]: one")).toEqual([]);
    });

    it("reindex numbers only the reference that renders and leaves the alt's dead text alone", () => {
        // the body's reference is the only live one, so it becomes [^1];
        // the alt's "[^1]" is dead text the plugin never rewrites (as in a
        // code span), and its definition, now unreferenced, takes the
        // next number as any orphan does
        expect(
            reindexFootnotes("see ![alt[^1]](url) then[^2]\n\n[^1]: stray\n[^2]: real", {
                renumberNamedFootnotes: false,
            }),
        ).toBe("see ![alt[^1]](url) then[^1]\n\n[^1]: real\n[^2]: stray");
    });

    it("control: a bracket-free alt is already dead (the existing blot)", () => {
        expect(refsOf("see ![ref ^1 here](url)\n\n[^1]: one")).toEqual([]);
    });

    it("control: a reference in link TEXT stays live (the pinned contrast)", () => {
        expect(refsOf("[x[^1]](url)\n\n[^1]: one")).toEqual(["1"]);
    });
});
