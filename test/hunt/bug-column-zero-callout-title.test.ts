import { describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import {
    orphanedFootnoteDefinitionNames,
    removeOrphanedFootnoteDefinitions,
} from "../../src/linting/rules/remove-orphaned-definitions";
import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// BUG: an ordinary paragraph line that happens to begin with "[!" is mistaken
// for a callout title, so a label on the next line is called a real
// definition when Obsidian reads it as plain paragraph text.
//
// The check that spots a callout title strips the "> " blockquote markers off
// the front of the line and then tests what is left, without ever checking
// that there were any markers to strip. At column 0 that makes "[!note] not a
// callout" look like a callout title, and so does the shields-style badge
// line "[![badge](img.svg)](https://ci.example)", which is an image inside a
// link and matches the same shape.
//
// What the user would see: the footnote silently does not render. Because the
// plugin believes the label is a real definition, nothing is reported, and
// with Move definitions to bottom switched off the fix-lazy rule adds no
// blank line, so nothing tells the user why their footnote is missing. That
// silence is exactly what the never-silent policy exists to prevent. Worse,
// with Delete orphaned definitions switched ON, a label under a badge line
// that nothing references is taken for an orphaned definition and deleted:
// visible prose disappears from the note.
//
// Hunt: 2026-09-13. Lens: the prose-label rule (attack-surface row 1).
//
// Source of truth: Obsidian's callout syntax, where a callout is a blockquote
// whose first line is "[!type]"; there is no such thing as a column-0
// callout. Manual sheet 14's control c4 is the real shape, "> [!note]" then
// "> [^c4]:".

const startsOf = (doc: string) => {
    const lines = doc.split("\n");
    return readNote(lines).labelLines;
};
const lastLineStarts = (doc: string) => startsOf(doc).at(-1);
const lazyNames = (doc: string) => {
    const lines = doc.split("\n");
    return lazyDefinitionLabelNames(lines);
};

describe("a callout title only exists inside a blockquote", () => {
    it("the real thing still works (sheet 14, control c4)", () => {
        expect(lastLineStarts("a[^1]\n\n> [!note]\n> [^1]: mid")).toBe(true);
        expect(lastLineStarts("a[^1]\n\n> [!note]- Folded\n> [^1]: mid")).toBe(true);
        // and a callout's BODY line is prose, so a label under that one is lazy
        expect(lastLineStarts("a[^1]\n\n> [!note]\n> body\n> [^1]: mid")).toBe(false);
    });

    it("a column-0 line starting with '[!' is paragraph text", () => {
        expect(lastLineStarts("a[^1]\n[!note] not a callout\n[^1]: mid")).toBe(false);
    });

    it("and so is a badge line, an image inside a link", () => {
        expect(lastLineStarts("a[^1]\n[![badge](img.svg)](https://ci.example)\n[^1]: mid")).toBe(false);
    });

    it("so the label under one is reported as lazy, and the fix rule fixes it", () => {
        const doc = "use[^1]\n[![badge](img.svg)](https://ci.example)\n[^1]: real";
        expect(lazyNames(doc)).toEqual(["1"]);
        expect(lintFootnotes(doc, { fixLazyDefinitions: true, moveDefinitionsToBottom: false })).toBe(
            "use[^1]\n[![badge](img.svg)](https://ci.example)\n\n[^1]: real",
        );
    });

    it("and deleting orphaned definitions does not eat the prose line under a badge", () => {
        // nothing references "1" here, so with the label mistaken for a real
        // definition the orphan rule deletes a line the user can see
        const doc = "[![badge](img.svg)](https://ci.example)\n[^1]: plain text, not a definition";
        expect(orphanedFootnoteDefinitionNames(doc)).toEqual([]);
        expect(removeOrphanedFootnoteDefinitions(doc)).toBe(doc);
    });
});
