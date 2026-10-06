// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 5 of 7 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-20 by Jason's ruling 1 (option b): a definition inside a list item is recognized by the orphan-reference alert and its deletion, the hotkey's navigate-or-create decision, and the renamers (reindex leaves the name alone, the rename command refuses); it is still never moved and never forms a block.
// All seven pass since 2026-10-06: the reader swap of 2026-10-03 reads these labels as Obsidian does, and the one test that asked the old block walker now asks the reading (see that test).
// VERIFIED IN READING VIEW 2026-09-16, NOT YET FIXED AT THE TIME: a label indented into a list item (absolute indent 4 under "- item", 7 under "10. item") renders as a definition, and one indented 6 under "- item" is code, exactly as pinned. The plugin has never recognized definitions inside list items (labels read relative to the document margin, like the C22 quoted-definition rule); fixing it touches every label reader, so it waits for Jason's ruling on whether definitions inside list items are in scope.
import { describe, expect, it } from "vitest";

import { orphanedFootnoteReferenceNames } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// A footnote label may be indented up to three spaces past the margin of
// the block it sits in. For a label inside a LIST ITEM that margin is the
// item's content column, which the scanner already knows everywhere else
// (list-relative fence indent, list-relative indented code). micromark
// agrees: "- item", blank, "    [^1]: def" parses a footnoteDefinition
// INSIDE the listItem (relative indent 2), "1. item", blank, "    [^1]:
// def" the same (relative 1), and "10. item", blank, "       [^1]: def"
// (relative 3) - while a relative indent of 4 is indented code. The
// plugin's DefinitionStart measures its "up to three spaces" from the
// DOCUMENT margin instead, so a label at absolute indent 4 or more inside
// an item is no label at all: not a definition, not a lazy label (the
// fix/alert pair needs a label to see), just a paragraph line carrying a
// live "[^1]" with no definition anywhere.
//
// What the user sees: Reading view renders their in-list footnote, but
// the lint's missing-definition alert nags about it; the hotkey on the
// "[^1]" APPENDS a second "[^1]:" definition at the bottom instead of
// navigating, and Obsidian then renders only the last one.
//
// Source of truth: micromark + mdast-util-gfm-footnote (the repo's
// designated oracle; no manual sheet records Reading view disagreeing on
// list-item labels - sheet 14's rule is about paragraphs, and the
// definition's up-to-3-spaces indent is CommonMark's own allowance). GFM
// footnote definitions inside list items indent from the item's content
// column like any other block.
//
// Settings involved: every definition-driven rule and alert inherits the
// scan; the creation press inherits it through listExistingFootnoteDefinitions.

function startsOf(doc: string): boolean[] {
    const lines = doc.split("\n");
    return readNote(lines).labelLines;
}

describe("a definition label indented into a list item (relative indent 1-3)", () => {
    it("dash item, relative indent 2 (absolute 4): a definition start", () => {
        expect(startsOf("- item\n\n    [^1]: def\n\nuse[^1]")[2]).toBe(true);
    });

    it("ordered item, relative indent 1 (absolute 4): a definition start", () => {
        expect(startsOf("1. item\n\n    [^1]: def\n\nuse[^1]")[2]).toBe(true);
    });

    it("double-digit ordered item, relative indent 3 (absolute 7): a definition start", () => {
        expect(startsOf("10. item\n\n       [^1]: def\n\nuse[^1]")[2]).toBe(true);
    });

    it("the reading finds the definition, so the reference is not an orphan, and it is no block to move", () => {
        // This test used to ask for a block, from the block walker the
        // reader swap replaced (2026-10-03). Ruling 1 says an in-item
        // definition never forms a block, and the reading's blocks are only
        // the definitions it may move, so the question is now whether the
        // reading lists the definition at all. Obsidian reads [^1] as a
        // definition on line 3 alone (saved answer
        // pin:bug-list-item-label-margin#1), and so does the reading; the
        // block list stays empty (Group L, 2026-10-06).
        const lines = "- item\n\n    [^1]: def\n\nuse[^1]".split("\n");
        const reading = readNote(lines);
        expect(reading.definitions.map((d) => [d.name, d.start, d.end, d.movable])).toEqual([["1", 2, 2, false]]);
        expect(reading.blocks).toEqual([]);
    });

    it("the missing-definition alert stays silent about it", () => {
        expect(orphanedFootnoteReferenceNames("- item\n\n    [^1]: def\n\nuse[^1]")).toEqual([]);
    });

    it("a label at the item's own margin (absolute 2) is an in-item definition, a label line like any other", () => {
        // Reading view renders it as a definition, inside the item. Since
        // Jason's ruling 1, option a (2026-10-03), every definition's label
        // line counts as one, wherever it sits; it used to be stepped over
        // by the label pass and owned by a reader of its own
        const doc = "- item\n\n  [^1]: def\n\nuse[^1]";
        expect(startsOf(doc)[2]).toBe(true);
        expect(orphanedFootnoteReferenceNames(doc)).toEqual([]);
    });

    it("control: dash item, relative indent 4 (absolute 6) is indented code to both parsers", () => {
        const doc = "- item\n\n      [^1]: def\n\nuse[^1]";
        const lines = doc.split("\n");
        expect(readNote(lines).protectedLines[2]).toBe(true);
        expect(startsOf(doc)[2]).toBe(false);
    });
});
