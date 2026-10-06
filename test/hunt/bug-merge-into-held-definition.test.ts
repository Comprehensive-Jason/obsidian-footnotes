import { describe, expect, it } from "vitest";

import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): Merge duplicate definitions puts the merged text
// into ANOTHER footnote when the first copy ends with a definition held
// inside it (an indented definition under it, a "held" definition).
//
// What the user would see: [^a] is defined twice, "one" and later "two".
// The first [^a] holds an indented "[^b]: inner" under it. After the
// merge, "two" sits under "[^b]: inner", so footnote b reads "inner two"
// and footnote a no longer shows "two".
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L2.
//
// Source of truth: the merge rule's own contract in
// merge-duplicate-definitions.ts ("merges the later bodies INTO the first
// definition block ... so no text is ever thrown away"; "The merged block
// therefore renders every body"). An indented line straight under
// "    [^b]: inner" continues b's paragraph, as CommonMark reads a
// paragraph continuation line.
//
// Cause: mergeDuplicateFootnoteDefinitions adds the merged lines after
// the LAST line of the first copy's block (appendAfter, keyed by
// base.end). When the first copy holds another definition at its end,
// that last line is the held definition's line, so the merged text joins
// the held definition's paragraph.

/** The body text of the copy of `name` Obsidian renders: the last one. */
function rendered(text: string, name: string): string {
    const lines = text.split("\n");
    const copies = readNote(lines).definitions.filter((d) => d.name.toLowerCase() === name);
    const last = copies[copies.length - 1];
    return [lines[last.start].slice(last.labelEnd), ...lines.slice(last.start + 1, last.end + 1)].join("\n").trim();
}

describe("merge with a held definition at the end of the first copy", () => {
    it.fails("the merged text stays a's, and b's text is unchanged", () => {
        const note = ["Text[^a] and[^b].", "", "[^a]: one", "", "    [^b]: inner", "", "[^a]: two"].join("\n");
        const out = mergeDuplicateFootnoteDefinitions(note);
        // Today: "[^a]: one", "", "    [^b]: inner", "    two", and b reads "inner two".
        expect(rendered(out, "b")).toBe("inner");
        expect(rendered(out, "a")).toContain("two");
    });
});
