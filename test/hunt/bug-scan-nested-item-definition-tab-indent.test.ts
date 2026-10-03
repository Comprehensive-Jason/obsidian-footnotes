import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes } from "../../src/linting/linter";
import { orphanedFootnoteReferenceNames } from "../../src/linting/rules/remove-orphaned-references";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// BUG (data loss with an opt-in rule): a footnote defined on a NESTED list
// item that is indented with a tab, or with four spaces, is not seen as a
// definition.
//
// What the user would see: Obsidian indents nested list items with a tab by
// default ("Indent using tabs"). The note has "- parent" and under it
// "<tab>- [^a]: nested def", and Reading view shows footnote a with "nested
// def". The plugin does not see that definition:
// - with Delete orphaned references on, a lint erases the "[^a]" in the
//   prose and cuts the brackets out of the label, leaving "<tab>- : nested
//   def";
// - a numbered press on the reference appends a second, empty "[^a]: "
//   definition at the bottom of the note instead of going to the one the
//   user wrote.
// The same happens with four spaces of indent, and under an ordered parent.
// Two spaces of indent already work (the control).
//
// Hunt 2026-10-02, round 4, lens root causes. Cluster O3 (root 3, "a tab
// where the plugin's patterns expect spaces"). This is a tab BEFORE the
// marker, which is plain indentation. It is not the refuted shape of
// commit 1928ad3 (a tab in the gap AFTER a marker, which Obsidian renders
// as code) nor round 3's spec-scan-tab-after-list-marker-label.
//
// Source of truth: Jason's ruling 1 (2026-09-20, commit f098798): a
// definition inside a list item is a real definition, recognised by the
// orphan-reference alert and its deletion and by the hotkey's
// navigate-or-create decision. micromark with the footnote extension
// renders "- parent" then "<tab>- [^a]: def", and the four-space twin, as
// footnote a with "def" (checked 2026-10-02 with the repo's
// node_modules/micromark).
//
// Severity: medium. With Delete orphaned references on, the user's
// reference and label are destroyed; with it off, the press writes a
// duplicate.
//
// Cause: the in-item reader's list-marker pattern allows at most three
// spaces before the marker (list-item-definitions.ts), so a nested item
// indented by a tab or four spaces is never read.

beforeEach(resetNotices);

const FACES: [string, string, string][] = [
    ["a tab (Obsidian's default indent)", "- parent", "\t- [^a]: nested def"],
    ["four spaces", "- parent", "    - [^a]: nested def"],
    ["a tab under an ordered parent", "1. parent", "\t1. [^a]: nested def"],
];

describe("a nested list item indented with a tab or four spaces holding a definition", () => {
    for (const [label, parent, nested] of FACES) {
        const lines = ["Text[^a] and[^b] here", "", parent, nested, "", "[^b]: col0"];
        const doc = lines.join("\n");

        it(`Delete orphaned references keeps the reference and the label (${label})`, () => {
            // Today: "Text and[^b] here", and the nested line loses its "[^a]".
            expect(lintFootnotes(doc, { removeOrphanedReferences: true })).toBe(doc);
        });

        it(`a numbered press on the reference appends no second definition (${label})`, async () => {
            const editor = fakeEditor(lines, { cursor: { line: 0, ch: 6 }, edits: true, wholeDoc: true, words: true });
            await insertAutonumFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, editor));
            // Today: ["[^a]: "].
            expect(editor.lines.filter((l) => l.startsWith("[^a]:"))).toEqual([]);
        });
    }

    it("control: two-space nesting is already read", () => {
        const lines = ["Text[^a] and[^b] here", "", "- parent", "  - [^a]: nested def", "", "[^b]: col0"];
        expect(orphanedFootnoteReferenceNames(lines.join("\n"))).toEqual([]);
        expect(lintFootnotes(lines.join("\n"), { removeOrphanedReferences: true })).toBe(lines.join("\n"));
    });
});
