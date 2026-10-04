import { describe, expect, it } from "vitest";

import { referenceOccurrences } from "../../src/parsing/footnote-grammar";
import { definitionStartLines, maskProtectedLines, scanDocument } from "../../src/parsing/markdown-scan";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (wrong output on default settings, silent): any "]" followed by
// "(...)" is treated as a link, even when it is none, so a live reference
// inside the parentheses is ignored and the lint rebinds it to another
// footnote's text.
//
// What the user would see: the line "see [t](a b[^1]) and x[^2]" has no
// link, because a link address cannot hold a space, so Reading view shows
// "[^1]" as footnote 1. The plugin hides it as part of a link address. The
// default lint renumbers the other footnotes around it: "[^2]: two"
// becomes "[^1]: two", so the visible "[^1]" now shows "two" instead of
// "one", and nothing is said. The same happens after an escaped opener,
// "\[t](a[^1])", and after a "]" with no "[" before it, "note](a[^1])".
//
// Needs a Reading-view check for the space-in-address face only: the
// escaped-opener and no-opener faces follow from CommonMark directly.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X11.
//
// Source of truth: CommonMark 6.3 (a link needs an unescaped "[" opener,
// and its destination cannot contain a space unless it is wrapped in
// "<...>"), checked with micromark.
//
// Cause: maskProtectedLines blots any "]" followed by "(...)" as a link
// destination without checking that a link really opens there.

// Every live reference in `doc`, as "line:name".
function liveReferences(doc: string): string[] {
    const lines = doc.split("\n");
    const scan = scanDocument(lines);
    const masked = maskProtectedLines(lines, scan);
    const starts = definitionStartLines(lines, scan, (i) => masked[i]);
    return lines.flatMap((l, i) => referenceOccurrences(l, masked[i], starts[i]).map((o) => `${i}:${o.name}`));
}

describe("a parenthesised run that is not a link destination", () => {
    it("'\\[t](a[^1])' has an escaped opener, so it is no link and [^1] is live", () => {
        expect(liveReferences("see \\[t](a[^1])\n\n[^1]: one")).toEqual(["0:1"]);
    });

    it("a ']' with no '[' before it opens no link, so 'note](a[^1])' keeps [^1] live", () => {
        expect(liveReferences("note](a[^1])\n\n[^1]: one")).toEqual(["0:1"]);
    });

    it("'[t](a b[^1])' is no link (a space needs a quoted title), so [^1] is live", () => {
        expect(liveReferences("see [t](a b[^1])\n\n[^1]: one")).toEqual(["0:1"]);
    });

    it.fails("a non-link '[t](a b[^1])' keeps its reference bound to the same text after the default lint", () => {
        const doc = "see [t](a b[^1]) and x[^2]\n\n[^2]: two\n\n[^1]: one";
        const out = lintFootnotes(doc);
        // Today: "see [t](a b[^1]) and x[^1]\n\n[^1]: two\n[^2]: one".
        // Whatever the numbering, the reference inside "(a b...)" must still
        // name the definition whose text is "one".
        const ref = /\(a b\[\^([^\]]+)\]\)/.exec(out)?.[1];
        expect(out).toContain(`[^${ref}]: one`);
    });
});
