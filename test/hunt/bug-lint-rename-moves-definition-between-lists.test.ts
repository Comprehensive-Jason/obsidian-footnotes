import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { judgeEdit } from "../../src/editor/result-gate";
import { parseObsidianNote, MarkdownNode } from "../../src/parsing/obsidian-markdown";

// BUG (wrong output): the default lint moves a definition out from between
// two lists, and the lists join into one, when the same lint also
// renumbers a footnote.
//
// What the user would see: "Intro[^a].", a blank line, "- one[^2].", a
// blank line, "[^a]: A.", a blank line, "- two[^2].", and "[^2]: B." at the
// bottom. Ctrl+S with the default lint renumbers [^2] to [^1] and moves
// "[^a]: A." to the bottom. With only a blank line left between "- one"
// and "- two", Reading view draws one loose list of two items where there
// were two lists. A larger everyday note, a list, a definition written
// under it, a second list, joins its two lists into one loose list of
// three. When nothing is renumbered, the lint leaves the definition where
// it is, as it should.
//
// A "definition" is the "[^a]: A." entry that holds a footnote's text. A
// list is "loose" when a blank line sits between two of its items, which
// draws every item with the wider spacing of a paragraph. The "result
// gate" is the one check every edit passes before it is written: the note
// after must read the same as the note before, except for what the action
// meant to change.
//
// Hunt 2026-10-08, cycle 7. Cluster Y6. Same family as cycle 6's Z4 (pin
// bug-gate-windows-trailing-line-break-joins-lists).
//
// Origin: pre-existing at 97abeac. The lint face is a regression from
// 7790b9f (the lint's one judgment of the whole lint); it worked at
// 7790b9f~1. The gate's marking of renamed lines, the cause below, is
// older.
//
// Source of truth: docs/obsidian-reading-rules.md B9 (two lists with only
// blank lines between them are one list; anything else between them, a
// footnote definition included, keeps them apart, and the plugin refuses
// to join them; saved answers h2:cn2-*) and B10 (a blank line between two
// items makes the whole list loose). Pin
// bug-definition-between-lists-joins-them (cluster CN2): the move never
// joins what was around a definition.
//
// Cause: editWindows in src/editor/result-gate.ts finds the stretches of
// lines an edit changed by lining up the note before with the note after
// on lines that did not change. It marks every line holding a renamed
// footnote so that line never anchors the lining up, since its text did
// change. With "- one[^2]" and "- two[^2]" both marked, the moved
// definition is left to anchor instead, and the second list's lines fall
// into the stretches as whole lines taken out and written in. Check 5 (the
// lines around an edit keep their block shape) does not compare such
// lines, so the join passes. The same edit with no rename is refused.

// The settings' defaults (src/settings.ts DEFAULT_SETTINGS).
const defaults: LintOptions = {
    fixPunctuation: true,
    placement: "after",
    fixLazyDefinitions: true,
    moveDefinitionsToBottom: true,
    reindex: true,
    reindexOptions: { renumberNamedFootnotes: false, nameNumberedFootnotes: false },
    removeOrphanedReferences: false,
    removeOrphanedDefinitions: false,
    mergeDuplicateDefinitions: false,
    orphanSafePrefix: "",
    applyNotePrefix: false,
    sectionHeading: "",
    removeEmptySectionHeading: false,
};

/** The lists the note draws at the top level, each as its kind, its item count, and whether it is loose, from the tree remark-parse 8 builds (the parser Obsidian uses). */
function lists(text: string): string[] {
    const { tree } = parseObsidianNote(text);
    return (tree.children ?? [])
        .filter((node: MarkdownNode) => node.type === "list")
        .map((node: MarkdownNode) => {
            const extra = node as unknown as { spread?: boolean; start?: number };
            return `${node.ordered ? `ordered from ${String(extra.start)}` : "bullets"}, ${String(node.children?.length)} items${extra.spread ? ", loose" : ""}`;
        });
}

const everyday = ["Oysters filter water[^src].", "", "- Oysters grow[^3].", "", "[^src]: Smith 2020.", "", "- Tides rise[^1].", "- Tides fall[^1].", "", "[^3]: Jones.", "[^1]: Brown."].join("\n");

describe("the default lint, a rename, and a definition between two lists", () => {
    it("control: the two lists are apart before the lint", () => {
        expect(lists(everyday)).toEqual(["bullets, 1 items", "bullets, 2 items"]);
    });

    // Now: "- Oysters grow.[^1]", "", "- Tides rise.[^2]", "- Tides
    // fall.[^2]", one loose list of three, with "[^src]: Smith 2020." moved
    // to the bottom.
    it.fails("bullets: the lint keeps the two lists apart", () => {
        const after = lintFootnotes(everyday, defaults);
        expect(lists(after), JSON.stringify(after.split("\n"))).toEqual(["bullets, 1 items", "bullets, 2 items"]);
    });

    it("control: numbered lists, the lint keeps the second list numbered from 1", () => {
        const note = ["Steps[^src]:", "", "1. Mix[^3].", "2. Rest.", "", "[^src]: From the manual.", "", "1. Bake[^1].", "2. Cool.", "", "[^3]: By hand.", "[^1]: At 200 degrees."].join("\n");
        const after = lintFootnotes(note, defaults);
        expect(lists(after), JSON.stringify(after.split("\n"))).toEqual(["ordered from 1, 2 items", "ordered from 1, 2 items"]);
    });

    // The smallest shape. Now: "Intro.[^a]", "", "- one.[^1]", "",
    // "- two.[^1]", "", "[^a]: A.", "[^1]: B.", one loose list of two.
    it.fails("smallest: a footnote the lint renumbers, cited in both lists", () => {
        const note = ["Intro[^a].", "", "- one[^2].", "", "[^a]: A.", "", "- two[^2].", "", "[^2]: B."].join("\n");
        const after = lintFootnotes(note, defaults);
        expect(lists(after), JSON.stringify(after.split("\n"))).toEqual(["bullets, 1 items", "bullets, 1 items"]);
    });

    it("control: a definition under the first list, every item of the second citing a footnote", () => {
        const note = [
            "# Survey",
            "",
            "Site A, by Smith[^smith]:",
            "",
            "- Oysters counted: 40[^2].",
            "- Spat on rope: 12.",
            "",
            "[^smith]: Smith, field log, 2026-05-01.",
            "",
            "- Water temperature: 18 C[^1].",
            "- Salinity: 30 ppt[^3].",
            "",
            "[^2]: Counted by hand.",
            "[^1]: Probe at 1 m.",
            "[^3]: Refractometer.",
        ].join("\n");
        const after = lintFootnotes(note, defaults);
        expect(lists(after), JSON.stringify(after.split("\n"))).toEqual(["bullets, 2 items", "bullets, 2 items"]);
    });
});

describe("the gate on its own: a definition moved out from between two lists", () => {
    const before = ["Intro[^a].", "", "- one[^2]", "", "[^a]: A.", "", "- two[^2]", "", "[^2]: B."];

    it("control: with no rename, the gate refuses the join", () => {
        const movedOnly = ["Intro[^a].", "", "- one[^2]", "", "- two[^2]", "", "[^a]: A.", "[^2]: B."];
        expect(judgeEdit(before, movedOnly, {}).pass).toBe(false);
    });

    // The root pin. Now the gate passes this edit (pass: true) once it is
    // told [^2] was renamed to [^1].
    it.fails("with [^2] renamed to [^1], the gate still refuses the join", () => {
        const renamedAndMoved = ["Intro[^a].", "", "- one[^1]", "", "- two[^1]", "", "[^a]: A.", "[^1]: B."];
        expect(judgeEdit(before, renamedAndMoved, { renamed: new Map([["2", "1"]]) }).pass).toBe(false);
    });
});
