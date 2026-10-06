import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { moveFootnoteDefinitionsToBottom } from "../../src/linting/rules/move-footnotes-to-the-bottom";
import { reindexFootnotes } from "../../src/linting/rules/re-index-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): the lint changes which copy of a duplicated
// footnote Obsidian shows, when one copy is held inside another
// footnote's definition (an indented definition under it, a "held" copy).
//
// What the user would see: [^b] is defined twice, once indented inside
// [^a]'s definition ("inner copy") and once at the top level further down
// ("top copy"). Reading view shows "top copy", the last one. After Move
// definitions to bottom, Reindex, or the default lint, [^a]'s definition
// (with the held [^b] inside it) ends up below the top-level [^b], and
// the footnote now shows "inner copy" (in the default-lint case, "held"
// instead of "top").
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L1.
//
// Source of truth: live Obsidian 1.14.4 (2026-10-05): with
// "[^b]: top copy" above "[^a]: outer" and its indented "[^b]: inner copy",
// Reading view draws b as "inner copy", so a copy held inside another
// footnote counts in "the last copy wins". Jason's decision (2026-10-05):
// a name with a copy in a quote, a list item, or another footnote never
// has its top-level copies moved or reordered by the lint. movedDefinitions'
// own comment in rewrite-document.ts says the same.
//
// Cause: movedDefinitions holds back the movable copies of a name that
// also has a copy staying put, so the top-level [^b] stays. But it does
// not look inside the blocks it lets move: [^a]'s block is movable, so it
// moves, and the held [^b] inside it travels with it, past the top-level
// [^b].

/** The body text of the copy of `name` Obsidian renders: the last one. */
function rendered(text: string, name: string): string {
    const lines = text.split("\n");
    const copies = readNote(lines).definitions.filter((d) => d.name.toLowerCase() === name);
    const last = copies[copies.length - 1];
    return [lines[last.start].slice(last.labelEnd), ...lines.slice(last.start + 1, last.end + 1)].join("\n").trim();
}

/** Each name's rendered body (its last definition), with quote markers and line breaks folded to single spaces. */
function shown(text: string): Map<string, string> {
    const lines = text.replace(/\r/g, "").split("\n");
    const reading = readNote(lines);
    const out = new Map<string, string>();
    for (const d of reading.definitions) {
        const body = lines
            .slice(d.start, d.end + 1)
            .map((l, i) => (i === 0 ? l.slice(d.labelEnd) : l))
            .join(" ")
            .replace(/[>\s]+/g, " ")
            .trim();
        out.set(d.name.toLowerCase(), body);
    }
    return out;
}

/** For every reference outside a definition, in order, the text its footnote shows. */
function cited(text: string): (string | undefined)[] {
    const lines = text.replace(/\r/g, "").split("\n");
    const reading = readNote(lines);
    const bodies = shown(text);
    return lines.flatMap((_, i) => (reading.definitionAt(i) ? [] : reading.referencesOn(i).map((o) => bodies.get(o.name.toLowerCase()))));
}

describe("a movable definition holding a copy of a duplicated name", () => {
    it.fails("move to bottom keeps the copy of b Obsidian renders", () => {
        const note = ["Text[^a] and[^b].", "", "[^a]: outer", "", "    [^b]: inner copy", "", "Para.", "", "[^b]: top copy"].join("\n");
        expect(rendered(note, "b")).toBe("top copy");
        // Today: "inner copy"; the note ends "[^b]: top copy", "", "[^a]: outer", "", "    [^b]: inner copy".
        expect(rendered(moveFootnoteDefinitionsToBottom(note, ""), "b")).toBe("top copy");
    });

    it.fails("reindex keeps the copy of b Obsidian renders", () => {
        const note = ["Text[^c] and[^a] and[^b].", "", "[^a]: outer", "", "    [^b]: inner copy", "", "[^b]: top copy", "", "[^c]: cee"].join("\n");
        expect(rendered(note, "b")).toBe("top copy");
        // Today: "inner copy"; [^c] swaps into a's slot and [^a] (with the held [^b]) into c's, below "[^b]: top copy".
        expect(rendered(reindexFootnotes(note, {}), "b")).toBe("top copy");
    });

    it.fails("the default lint keeps every reference's text", () => {
        const note = "x[^b] y[^a]\n\n[^a]: outer\n\n    [^b]: held\n\n[^b]: top";
        expect(cited(note)).toEqual(["top", "outer [^b]: held"]);
        // Today: ["held", "outer [^b]: held"], the reference to b shows the held copy.
        expect(cited(lintFootnotes(note, {}))).toEqual(cited(note));
    });
});
