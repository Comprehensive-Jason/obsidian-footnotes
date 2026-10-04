// Imported from the Kimi K3 cycle 1 hunt of 2026-09-16 (OpenCode worktree); 15 of 17 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { computeNextFootnoteNumber } from "../../src/parsing/footnote-grammar";

import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { applyFootnotePrefix } from "../../src/linting/rules/apply-footnote-prefix";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// A "[^1]" inside a link's destination is URL TEXT, not a footnote: the
// destination of "[x](https://e.com/[^1])" is the literal string
// "https://e.com/[^1]", and no markdown processor parses a footnote out
// of it (verified against micromark 2026-09-16: link node, plain text,
// no footnoteReference). Same for an image destination, an autolink
// "<https://e.com/[^1]>", and a bare URL.
//
// The plugin's reference scan knows nothing about destinations: the
// masked twin keeps the line whole, and the "[^1]" inside the URL counts
// as a live reference. Worse, the plugin's OWN landing convention
// already rules links atomic: linkLikeEndAt (markdown-scan.ts) exists
// precisely because "a reference belongs after the whole construct,
// never inside it (Jason's landing rulings, 2026-09-15)". The insert
// path obeys that; the scanner and every lint rule built on
// referenceOccurrences does not. The two halves of the plugin disagree.
//
// What the user sees, with "Delete orphaned references" ON: lint cuts
// the "[^1]" out of their link, leaving "see [x](https://e.com/)" - the
// link silently mangled. With the toggle off, the missing-definition
// alert nags about URL text on every lint. The numbered command skips a
// number for the URL's sake, and reindex/apply-prefix rename text inside
// the URL.
//
// Source of truth: micromark (GFM) as run for this hunt + the plugin's
// own landing convention (linkLikeEndAt's contract). Settings involved:
// `Delete orphaned references` (the destructive half), plus the default
// reindex and the numbered command (the renumbering half).

const refs = (line: string): string[] => {
    return readNote([line]).referencesOn(0).map((o) => o.name);
};

describe("a reference-shaped string inside a link destination is URL text, not a footnote", () => {
    beforeEach(resetNotices);

    it("orphan deletion never cuts text out of a markdown link's destination", () => {
        expect(removeOrphanedFootnoteReferences("see [x](https://e.com/[^1])")).toBe(
            "see [x](https://e.com/[^1])",
        );
    });

    it("orphan deletion never cuts text out of a bare URL", () => {
        expect(removeOrphanedFootnoteReferences("see https://e.com/[^1]")).toBe(
            "see https://e.com/[^1]",
        );
    });

    it("the scan does not count a [^1] inside a link destination as a reference", () => {
        expect(refs("see [x](https://e.com/[^1])")).toEqual([]);
    });

    it("the scan does not count a [^1] inside an image destination as a reference", () => {
        expect(refs("see ![alt](img-[^1].png)")).toEqual([]);
    });

    it("the scan does not count a [^1] inside an autolink as a reference", () => {
        expect(refs("see <https://e.com/[^1]>")).toEqual([]);
    });

    it("the scan does not count a [^1] inside a bare URL as a reference", () => {
        expect(refs("see https://e.com/[^1]")).toEqual([]);
    });

    it("the scan does not count a [^1] inside a wikilink alias as a reference", () => {
        expect(refs("see [[note|[^1]]]")).toEqual([]);
    });

    it("the scan does not count a [^1] inside a wikilink target as a reference", () => {
        expect(refs("see [[note[^1]]]")).toEqual([]);
    });

    it("the scan does not count a [^1] inside an embedded wikilink as a reference", () => {
        expect(refs("see ![[img[^1].png]]")).toEqual([]);
    });

    it("orphan deletion never cuts text out of a wikilink", () => {
        expect(removeOrphanedFootnoteReferences("see [[note|[^1]]]")).toBe("see [[note|[^1]]]");
    });

    it("the missing-definition alert never names URL text", () => {
        noticeLintAlerts(fakePlugin({}), "see [x](https://e.com/[^1])");
        expect(messages().some((m) => m.includes("[^1]"))).toBe(false);
    });

    it("the numbered command does not reserve the URL's number", () => {
        expect(computeNextFootnoteNumber("see [x](https://e.com/[^1])")).toBe(1);
    });

    it("the punctuation rule never cuts a reference out of a link destination", () => {
        // today: "see [x](https://e.com/),[^1] next" - the URL loses the
        // [^1] and the reference lands after the link
        expect(footnoteAfterPunctuation("see [x](https://e.com/[^1]), next")).toBe(
            "see [x](https://e.com/[^1]), next",
        );
    });

    it("reindex never renumbers a reference-shaped string inside a link destination", () => {
        expect(reindexFootnotes("see [x](https://e.com/[^2])")).toBe("see [x](https://e.com/[^2])");
    });

    it("apply-prefix never rewrites a reference-shaped string inside a link destination", () => {
        expect(applyFootnotePrefix("see [x](https://e.com/[^1])", "p.")).toBe(
            "see [x](https://e.com/[^1])",
        );
    });

    it("control: a genuine orphaned reference is still deleted", () => {
        expect(removeOrphanedFootnoteReferences("see [^1]")).toBe("see");
    });

    it("control: \"[^1](url)\" is a link whose text is \"^1\", with no footnote in it", () => {
        // Corrected 2026-10-03 (the runtime swap, step 4): this control
        // said the "[^1]" was the link's text and still a footnote, as
        // micromark reads it. Obsidian reads the whole as a link and shows
        // no footnote, in its metadata cache and in Reading view (live
        // answer swap34:ref-as-link-text, test/obsidian-answers/
        // swap34-probes.json), and so does the note reading; with a space
        // before the "(" it is a footnote again (swap34:ref-as-link-text-space).
        expect(refs("see [^1](https://e.com/)")).toEqual([]);
        expect(refs("see [^1] (https://e.com/)")).toEqual(["1"]);
    });
});
