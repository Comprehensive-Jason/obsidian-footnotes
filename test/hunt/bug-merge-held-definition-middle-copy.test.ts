import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): with Merge duplicate definitions on, a footnote
// defined three times whose MIDDLE copy ends with a definition held inside
// it gets its third copy's text written under that held definition, which
// then takes the text as its own.
//
// What the user would see: [^2] is defined three times. The second copy
// ends with "    [^1]: w2", indented under it. Ctrl+S merges the copies,
// and the third copy's "w5" lands right under "[^1]: w2". Reading view
// shows footnote 1 as "w2 w5", and footnote 2 has lost "w5". Nothing warns
// the user.
//
// A "held" definition is one written inside another footnote's text,
// indented under it.
//
// Hunt 2026-10-06, cycle 5, lens lint. Cluster X34.
//
// Origin: pre-existing.
//
// Source of truth: CommonMark's paragraph continuation (a line straight
// under a paragraph line, with no blank line between, carries on that
// paragraph); the merge's promise that every other footnote reads as
// before. This is a sibling of the fixed bug-merge-into-held-definition
// (hunt 2026-10-05 round 2, cluster L2), which covers a held definition at
// the end of the FIRST copy only.
//
// Cause: mergeDuplicateFootnoteDefinitions in
// src/linting/rules/merge-duplicate-definitions.ts gathers the lines of
// every later copy into one list and adds a blank line in front only when
// the FIRST copy ends with a held definition. Between the second copy's
// last line and the third copy's text it adds nothing, and it never asks
// definitionsReadDifferently whether the merged note reads every
// definition as before.

const note = "[^2]: w0\n\n[^2]: w1\n\n    [^1]: w2\n\nPara w3[^2] and w4[^1].\n\n[^2]: w5";

/** The text of the last definition of `name`, on one line with single spaces; "<none>" when the note does not define it. */
function textOf(markdown: string, name: string): string {
    const lines = markdown.split("\n");
    const reading = readNote(lines);
    const d = reading.definitions.filter((x) => x.name === name).at(-1);
    if (!d) return "<none>";
    return [lines[d.start].slice(d.labelEnd), ...lines.slice(d.start + 1, d.end + 1)].join(" ").replace(/\s+/g, " ").trim();
}

/**
 * The name of the footnote cited right after `word` in the text, so a test
 * can follow it through reindex's renaming. Punctuation may sit between
 * the two, since the lint moves a reference after a full stop.
 */
function citedAfter(markdown: string, word: string): string {
    return new RegExp(`${word}[.,;:!?]*\\[\\^([^\\]]+)\\]`).exec(markdown)?.[1] ?? "<none>";
}

describe("merging past a middle copy that holds a definition", () => {
    // Now: "w2 w5".
    it.fails("the merge leaves the held [^1]'s text as it was", () => {
        expect(textOf(note, "1")).toBe("w2");
        expect(textOf(mergeDuplicateFootnoteDefinitions(note), "1")).toBe("w2");
    });

    // Reindex renames the footnotes in reference order ([^2] becomes [^1]
    // and [^1] becomes [^2]), so the held footnote is found by the
    // reference after "w4".
    // Now: "Para w3[^1] and w4.[^2]\n\n[^1]: w0\n    w1\n\n    [^2]: w2\n    w5",
    // so the held footnote, renamed [^2], reads "w2 w5".
    it.fails("the lint with Merge duplicate definitions on leaves the held footnote reading w2", () => {
        const out = lintFootnotes(note, { mergeDuplicateDefinitions: true });
        expect(textOf(out, citedAfter(out, "w4"))).toBe("w2");
    });
});
