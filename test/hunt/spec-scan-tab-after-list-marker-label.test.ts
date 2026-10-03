// SETTLED 2026-10-03 by the note reading (the runtime swap, step 1): rule B1 in docs/obsidian-reading-rules.md, from Obsidian's own answers, reads "-\t[^1]: def" as a definition inside a list item, and "-" plus a tab under a label as a new list item that ends the definition, as "- " is. Every test below now holds. The question below is kept as it was asked.
import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { lintFootnotes } from "../../src/linting/linter";
import { orphanedFootnoteReferenceNames } from "../../src/linting/rules/remove-orphaned-references";
import { inItemDefinitionLabels } from "../helpers/in-item";
import { findDefinitionBlocks, scanDocument } from "../../src/parsing/markdown-scan";

// spec question: is "-\t[^a]: def", a label written right after a list
// marker with a TAB between them, a definition inside the list item, the
// way "- [^a]: def" is? And, the same question from the other side (round
// 4): is "-\titem" directly under a definition label a new list item
// that ends the definition, the way "- item" is?
//
// What it does now: the plugin reads "- [^a]: def" as a definition inside
// the item (ruling 1 of f098798), but only when spaces follow the marker.
// With a tab there, the label's "[^a]" is read as a plain reference with
// no definition. The orphan alert names [^a], and with Delete orphaned
// references on, the lint erases the "[^a]" in the prose and cuts the
// label's brackets, leaving "-\t: def".
//
// What a user might expect: CommonMark reads "-\tfoo" as a list item
// holding "foo" (the tab only reaches column 4, short of the five columns
// that would make indented code), and micromark with the footnote
// extension renders "text[^a]" over "-\t[^a]: def" exactly as it renders
// the same note with a space after the marker: footnote a, "def", with a
// live reference.
//
// Why it is a question and not a bug: commit 1928ad3 recorded "Refuted: a
// tab in a list marker's gap (Obsidian renders the chunk as code, as the
// plugin does)". That probe was about an indented chunk after the gap, not
// a label right after it, so this is likely settled already as not a
// definition. The only open part is whether Reading view agrees for a
// label. If Obsidian renders it as a footnote, the plugin is wrong and
// this becomes a bug; if it renders code or plain text, the pin is
// deleted.
//
// Round 4 found the other face of the same question. A line "-\titem"
// (or "#\tHeading") directly under a definition label is read by the
// plugin as more of that definition's text, while the space spellings
// ("- item", "# Heading") end the definition. So the default lint carries
// the line to the bottom of the note with the definition, and Delete
// footnote everywhere deletes it along with the definition. If Obsidian
// reads "-" and a tab as a list marker (and "#" and a tab as a heading,
// as CommonMark 4.2 and 5.2 allow), that is data loss and a bug; if it
// reads the line as part of the footnote, the plugin is right. Commit
// 96c2501 recorded the nearest ground truth: ">\t[^1]: def" renders as
// quoted code, so Obsidian may not take a tab after a marker the way
// CommonMark does.
//
// Needs a Reading-view check, one question behind every test here: does
// Obsidian read "-" followed by a tab as a list marker? Two notes settle
// it, with real tabs: "text[^a]" then a blank line then "-\t[^a]: def";
// and "T[^1]", a blank line, "[^1]: one", "-\titem", a blank line,
// "More prose.".
//
// Hunt 2026-10-02, round 3, lens reg. Cluster E1. The last two tests: round
// 4, lens root causes, cluster O2.
//
// Source of truth: Obsidian's Reading view, which has not been probed for
// this shape; CommonMark 2.2 (tabs) and 5.2 (list items) and micromark as
// the reading that would make it a definition.

const doc = ["text[^a] and[^b]", "", "-\t[^a]: def", "", "[^b]: col0"].join("\n");

/** A note whose definition [^1] has `second` directly under its label, then a blank line and more prose. */
function underLabel(second: string): string[] {
    return ["T[^1]", "", "[^1]: one", second, "", "More prose."];
}

describe("spec question: a label behind a tab after a list marker", () => {
    it("the in-item reader sees '-\\t[^a]: def' like '- [^a]: def'", () => {
        // it was [] before the note reading
        expect(inItemDefinitionLabels(doc.split("\n")).map((l) => l.name)).toEqual(["a"]);
    });

    it("the orphan alert does not name [^a]", () => {
        // Today: ["a"].
        expect(orphanedFootnoteReferenceNames(doc)).toEqual([]);
    });

    it("Delete orphaned references keeps the reference and the label", () => {
        // Today: "text and[^b]\n\n-\t: def\n\n[^b]: col0".
        expect(lintFootnotes(doc, { removeOrphanedReferences: true })).toBe(doc);
    });

    it("Delete footnote everywhere on [^1] keeps '-\\titem' under its label (data loss)", () => {
        const plan = deleteFootnoteEverywhere(underLabel("-\titem").join("\n"), "1");
        expect(plan.kind).toBe("deleted");
        // Today: "T\n\nMore prose." (the list item goes with the definition).
        expect((plan as { markdown: string }).markdown.split("\n")).toContain("-\titem");
    });

    it("the block reader ends [^1] above '#\\tHeading'", () => {
        const lines = underLabel("#\tHeading");
        // Today: [[2, 3]] (the heading is read as the definition's text).
        expect(findDefinitionBlocks(lines, scanDocument(lines)).map((b) => [b.start, b.end])).toEqual([[2, 2]]);
    });

    it("control: with a space after the marker the plugin already reads a definition", () => {
        const spaced = ["text[^a] and[^b]", "", "- [^a]: def", "", "[^b]: col0"].join("\n");
        expect(orphanedFootnoteReferenceNames(spaced)).toEqual([]);
        expect(lintFootnotes(spaced, { removeOrphanedReferences: true })).toBe(spaced);
        for (const second of ["- item", "# Heading"]) {
            const lines = underLabel(second);
            expect(findDefinitionBlocks(lines, scanDocument(lines)).map((b) => [b.start, b.end])).toEqual([[2, 2]]);
        }
    });
});
