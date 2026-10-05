import { describe, expect, it } from "vitest";

import { readNote } from "../../src/parsing/note-reading";
import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { planCut } from "../../src/commands/carry-footnotes";

// BUG (data loss): taking out a footnote's definition also takes out a
// second footnote's definition that sits inside it, though the text
// still references the second footnote.
//
// What the user would see: their note has "Text[^a] and[^b] more.",
// then "[^a]: outer", a blank line, and "    [^b]: inner". To Obsidian,
// [^b] is defined inside [^a]'s definition. The user deletes footnote
// [^a] everywhere, or lets the lint delete [^a] once nothing references
// it, or cuts the only text that cites [^a]. Each time [^a]'s whole
// definition goes, "    [^b]: inner" with it, and [^b] in the text is
// left with no definition.
//
// Hunt 2026-10-05, round 1, lens containers. Cluster CN1.
//
// Source of truth: Obsidian's answers probe:e2-blank-sp4label and
// probe:e2-cont-label-blank in test/obsidian-answers probes.json ([^b]
// is defined, inside [^a]'s range); ADR 0001 and CONTEXT.md, and ruling
// 1, option a, 2026-10-03 (a definition nested in another counts like
// any other definition). Merging [^a]'s duplicate and converting to
// inline already keep [^b].
//
// Cause: delete everywhere, orphan deletion, and the cut remove [^a]'s
// definition block from its first line to its last, and the reader puts
// [^b]'s line inside that block, so it goes too. None of the three asks
// whether a definition the text still needs sits inside the block.

const NOTE = ["Text[^a] and[^b] more.", "", "[^a]: outer", "", "    [^b]: inner"];

describe("a definition inside another footnote's definition", () => {
    it.fails("delete footnote a leaves b defined (or refuses)", () => {
        const plan = deleteFootnoteEverywhere(NOTE.join("\n"), "a");
        if (plan.kind !== "deleted") return;
        // Today: no definition is left.
        expect(readNote(plan.markdown.split("\n")).definitions.map((d) => d.name)).toContain("b");
    });

    it.fails("orphan deletion of a (unreferenced) leaves b, which the text references, defined", () => {
        const md = NOTE.join("\n").replace("Text[^a]", "Text");
        const out = removeOrphanedFootnoteDefinitions(md);
        expect(readNote(out.split("\n")).definitions.map((d) => d.name)).toContain("b");
    });

    it.fails("a cut of the only reference to a keeps b defined in the note", () => {
        const plan = planCut(NOTE.join("\n"), { line: 0, ch: 0 }, { line: 0, ch: 8 });
        expect(readNote(plan.text.split("\n")).definitions.map((d) => d.name)).toContain("b");
    });
});
