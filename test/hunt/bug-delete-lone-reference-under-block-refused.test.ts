import { beforeEach, describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { lintFootnotes } from "../../src/linting/linter";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): Delete footnote everywhere refuses a reference that sits
// alone on the first line of a paragraph, which is where a press on the
// blank line under a heading, a thematic break, a code block, or a table
// writes it.
//
// What the user would see: "# Tides", a blank line, then "Oysters
// closed.". A press of the numbered key on the blank line writes "[^1]"
// there, so the note reads "# Tides", "[^1]", "Oysters closed.", with
// "[^1]: Tide tables." at the end. Delete footnote everywhere on [^1] then
// says "Nothing was deleted: removing "[^1]" would change how Obsidian
// reads the text around it. Delete it by hand." It would not: without the
// "[^1]" line the note reads as the heading and the paragraph "Oysters
// closed.", the note as it was before the press. The same happens under
// "---", a fenced code block, and a table, and under plain prose with a
// blank line between ("Intro.", "", "[^1]", "Oysters closed.").
//
// A "thematic break" is a "---" line that Obsidian draws as a horizontal
// rule. The "result gate" is the one check every edit passes before it is
// written: the note after must read the same as the note before, except
// for what the edit meant to change.
//
// Hunt 2026-10-08, cycle 7. Cluster Y10.
//
// Origin: pre-existing at 97abeac, which refuses it too. Jason's ruling Q28
// came after that commit (3112455) and already takes the emptied line out
// under a heading, a rule, a code block, or a table, but the result gate
// still refuses. The refusal comes from the gate's check 5, which has
// judged this command since 728d226.
//
// Source of truth: Jason's ruling Q28 (sprout-c6-rulings.md 5,
// 2026-10-08): a reference alone on a line between two text lines is
// deleted with the line it emptied. docs/obsidian-reading-rules.md G1 and
// its saved answer gs3:b1-prose: "The tide rose.\n[^1]\nOysters closed."
// is one paragraph of three lines, so the "[^1]" line and "Oysters
// closed." are one paragraph, and without the "[^1]" line "Oysters
// closed." is that paragraph alone. Rule C4: any line that is not a table
// row ends the table above it. Taking the emptied line out and leaving it
// blank read the same in Obsidian. Jason picked leaving it blank
// (2026-10-08), which gives back the note as it was before the press; a
// reference alone between two lines of text still goes with its line
// (Q28). The tests first accepted either, and now expect the blank line.
//
// Cause: before the deletion the "[^1]" line starts the paragraph and
// "Oysters closed." carries it on; after it, "Oysters closed." starts the
// paragraph. Check 5 of the result gate compares how each line reads
// (sameKind in src/editor/result-gate.ts). It accepts a line that started
// a block coming to carry one on, which is what a press on a blank line
// does (Jason's ruling B1), but not the other way round, so it counts the
// paragraph's own first line as changed and refuses.

const Settings = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);

/** What sits above the blank line the press writes on, by name. */
const Above: [string, string[]][] = [
    ["a heading", ["# Tides"]],
    ["a thematic break", ["Intro.", "", "---"]],
    ["a code block", ["```", "code", "```"]],
    ["a table", ["| a | b |", "| - | - |", "| c | d |"]],
    ["prose with a blank line between", ["Intro.", ""]],
];

/**
 * Deletes footnote 1 everywhere from the note `above`, "[^1]",
 * "Oysters closed.", with its definition at the end, and checks that it
 * was deleted and that the note is as it was before the press: the emptied
 * line left blank (Jason, 2026-10-08).
 */
function expectDeletedWithItsLine(above: string[]) {
    const plan = deleteFootnoteEverywhere([...above, "[^1]", "Oysters closed.", "", "[^1]: Tide tables."].join("\n"), "1");
    expect(plan.kind, JSON.stringify(plan)).toBe("deleted");
    const markdown = plan.kind === "deleted" ? plan.markdown : "";
    expect(markdown).not.toContain("[^1]");
    expect(markdown).toBe([...above, "", "Oysters closed."].join("\n"));
}

describe("a reference alone on the first line of a paragraph", () => {
    // The first four are where a press writes the reference (ruling B1);
    // the plain-prose case shows the cause is wider than Q28's neighbours.
    it.each(Above.slice(0, 4))("control: a press on the blank line under %s writes the reference there", async (_what, above) => {
        const doc = fakeEditor([...above, "", "Oysters closed."], { cursor: { line: above.length, ch: 0 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(doc.lines).toEqual([...above, "[^1]", "Oysters closed.", "", "[^1]: "]);
        expect(messages()).toEqual([]);
    });

    // Now: refused with "Nothing was deleted: removing "[^1]" would change
    // how Obsidian reads the text around it. Delete it by hand."
    it.each(Above)("Delete footnote everywhere under %s deletes it, and the note reads as before the press", (_what, above) => {
        expectDeletedWithItsLine(above);
    });
});

// Characterization test (behaviour pinned as it is, found while fixing):
// the same gate change lets the lint's Delete orphaned references take a
// lone orphaned reference out from under a heading, leaving its line
// blank. On 34d5377 the gate held that deletion back, and the lint renamed
// the orphan to [^1] instead.
describe("the lint with Delete orphaned references on", () => {
    it("takes a lone orphaned reference out from under a heading, leaving its line blank", () => {
        expect(lintFootnotes(["# Tides", "[^9]", "Oysters closed."].join("\n"), { removeOrphanedReferences: true })).toBe(["# Tides", "", "Oysters closed."].join("\n"));
    });
});
