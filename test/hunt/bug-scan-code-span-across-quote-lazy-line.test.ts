import { describe, expect, it } from "vitest";


import { lintFootnotes } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output on default settings): a code span that starts in a
// blockquote and closes on the next, unquoted line is not seen as code, so
// the default lint renumbers text inside it.
//
// What the user would see: the quote line "> a `x [^5]" is followed by
// "y` b" with no ">" in front. That line carries on the quote's paragraph
// (a lazy continuation), so the backticks pair up across the two lines and
// "[^5]" is code. The default lint reads it as a live reference and
// rewrites the code to "> a `x [^1]".
//
// Needs a Reading-view check: micromark reads the two lines as one
// paragraph with one code span; Obsidian itself has not been probed for
// this shape. (The same-depth twin, "> `code" over "> span`", was probed
// and is resolved: bug-code-span-crosses-quote-continuation.)
//
// Hunt 2026-10-02, round 2, lens context. Cluster X4.
//
// Source of truth: CommonMark (a lazy continuation line belongs to the
// quote's paragraph, and a code span can cross lines of one paragraph) and
// Jason's 2026-08-10 ruling that text inside code is untouchable.
//
// Cause: the scanner's cross-line code-span search does not follow a
// quote's paragraph onto a lazy column-0 line.

// Every live reference in `doc`, as "line:name".
function liveReferences(doc: string): string[] {
    const lines = doc.split("\n");
    return lines.flatMap((_, i) => readNote(lines).referencesOn(i).map((o) => `${i}:${o.name}`));
}

describe("a code span across a quote's lazy continuation line", () => {
    it("the default lint never rewrites text inside a code span that crosses a quote's lazy line", () => {
        const doc = "> a `x [^5]\ny` b\n\nuse[^1]\n\n[^1]: one";
        // Today: "> a `x [^1]\ny` b\n\nuse[^2]\n\n[^2]: one".
        expect(lintFootnotes(doc)).toContain("> a `x [^5]");
    });

    it("'> a `x [^1]' then 'y` b' is one paragraph, the span crosses, and [^1] is dead", () => {
        expect(liveReferences("> a `x [^1]\ny` b\n\nuse[^2]\n\n[^2]: two")).toEqual(["3:2"]);
    });
});
