import { beforeEach, describe, expect, it } from "vitest";

import { readNote } from "../../src/parsing/note-reading";
import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { removeOrphanedFootnoteDefinitions } from "../../src/linting/rules/remove-orphaned-definitions";
import { planCut } from "../../src/commands/carry-footnotes";
import { nestedFootnoteDefinitionNames, noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

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
//
// Decided (2026-10-05, from ADR 0001 and ADR 0002: hand-typed nesting is
// reported, never destroyed): Delete footnote everywhere refuses and names
// the inner definition; orphan deletion keeps the outer definition, and the
// orphan alert names it as one the lint left in place; the nesting alert
// names the outer definition.

beforeEach(resetNotices);

const NOTE = ["Text[^a] and[^b] more.", "", "[^a]: outer", "", "    [^b]: inner"];

describe("a definition inside another footnote's definition", () => {
    it("delete footnote a refuses and names b, which sits inside it", () => {
        const plan = deleteFootnoteEverywhere(NOTE.join("\n"), "a");
        // Before the fix: deleted, and no definition was left.
        expect(plan.kind).toBe("refused");
        if (plan.kind === "refused") expect(plan.reason).toContain('"[^b]:"');
    });

    it("delete footnote b, the inner one, still goes ahead", () => {
        const plan = deleteFootnoteEverywhere(NOTE.join("\n"), "b");
        expect(plan.kind).toBe("deleted");
        if (plan.kind === "deleted") expect(plan.markdown).toBe("Text[^a] and more.\n\n[^a]: outer");
    });

    it("orphan deletion of a (unreferenced) leaves b, which the text references, defined", () => {
        const md = NOTE.join("\n").replace("Text[^a]", "Text");
        const out = removeOrphanedFootnoteDefinitions(md);
        expect(readNote(out.split("\n")).definitions.map((d) => d.name)).toContain("b");
    });

    it("orphan deletion takes both when nothing references the inner one either", () => {
        const md = NOTE.join("\n").replace("Text[^a] and[^b] more.", "Text more.");
        expect(removeOrphanedFootnoteDefinitions(md)).toBe("Text more.");
    });

    it("orphan deletion takes both when only the outer one's body cites the inner one", () => {
        const md = ["Text more.", "", "[^a]: outer[^b]", "", "    [^b]: inner"].join("\n");
        expect(removeOrphanedFootnoteDefinitions(md)).toBe("Text more.");
    });

    it("the orphan alert names a as left in place, with deletion on", () => {
        const md = NOTE.join("\n").replace("Text[^a]", "Text");
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS, lintDeleteOrphanedDefinitions: true }), md);
        const orphan = messages().find((m) => m.includes("nothing references"));
        expect(orphan).toContain('"[^a]"');
        expect(orphan).toContain("left it in place");
    });

    it("the nesting alert names a, which holds b's definition", () => {
        expect(nestedFootnoteDefinitionNames(NOTE)).toEqual(["a"]);
    });

    // The cut decides which definitions to take by asking the orphan rule
    // which ones the cut leaves unreferenced, so the orphan rule's fix
    // covers it too.
    it("a cut of the only reference to a keeps b defined in the note", () => {
        const plan = planCut(NOTE.join("\n"), { line: 0, ch: 0 }, { line: 0, ch: 8 });
        expect(readNote(plan.text.split("\n")).definitions.map((d) => d.name)).toContain("b");
    });
});
