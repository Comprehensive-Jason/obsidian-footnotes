import { beforeEach, describe, expect, it } from "vitest";

import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { convertInlineToNormalCommand, convertNormalToInlineCommand } from "../../src/commands/convert-footnotes";
import { deleteFootnote } from "../../src/commands/delete-footnote";
import FootnotePlugin from "../../src/main";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// With "Merge duplicate definitions" on, a command that runs no lint left a
// footnote defined twice and said nothing about it: Delete footnote
// everywhere, both Convert commands, and a carried paste with Lint on
// footnote creation off. Seen live on sprout's Obsidian 1.14.4 on
// 2026-10-22 (run toast-bugs): in "One[^a] two[^z] three." with "[^a]:"
// defined twice, Delete footnote everywhere on z toasted the deletion and
// the orphan alert for another footnote, but not the duplicate a; Convert
// normal to inline even named "[^a]" as skipped for being "defined more
// than once", with no alert; with the toggle off, each of them gave the
// duplicate alert.
//
// Expected: the duplicate alert speaks whenever duplicates remain and were
// not merged (Jason, 2026-10-22). Nothing merged them here, so the alert
// speaks as it does with the toggle off, as the orphan alerts already do
// after these commands (bug-lint-delete-everywhere-orphan-unreported). Its
// advice to turn the toggle on is dropped, since the toggle is on: "Merge
// them." (the plainer of the run's two drafts, for Jason's review).
//
// Cause: noticeDuplicateDefinitions was never told whether a lint had run.
// With the toggle on, it stayed quiet about any duplicate the merge could
// fix, counting on the lint to have merged it.
//
// Origin: pre-existing, red at a9acb87. Found by reading the code for the
// toast inventory of 2026-10-22 (its "odd things" item 16).

const ONE = 'This note defines "[^a]" more than once. Obsidian renders only the last definition. Merge them.';
const TOGGLE_OFF = 'This note defines "[^a]" more than once. Obsidian renders only the last definition. Merge them, or turn on "Merge duplicate definitions".';

const merging = { ...DEFAULT_SETTINGS, lintMergeDuplicateDefinitions: true, lintOnFootnoteCreation: false, enablePopupEditor: false };

function editor(lines: string[], caret = { line: 0, ch: 0 }): FakeEditor {
    return fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: caret, selection: { anchor: caret, head: caret } });
}

function duplicateAlerts(): string[] {
    // after a lint, a copy the merge cannot touch gets this alert too, with
    // what the lint left added to it (Jason, 2026-11-05)
    return messages().filter((m) => m.startsWith("This note defines"));
}

/** Pastes "See[^p]." carrying "[^p]: Pasted." at the caret, as Ctrl+V does. */
function paste(plugin: FootnotePlugin, doc: FakeEditor): void {
    resetCarryRegister();
    const took = handlePaste(
        plugin,
        {
            defaultPrevented: false,
            clipboardData: { types: ["text/plain"], getData: () => "See[^p].\n\n[^p]: Pasted.", setData() {} },
            preventDefault() {},
            stopPropagation() {},
        } as never,
        doc,
    );
    expect(took).toBe(true);
}

beforeEach(resetNotices);

describe("with merging on, a command that runs no lint names the duplicate it leaves", () => {
    it("Delete footnote everywhere", async () => {
        const doc = editor(["One[^a] two[^z] three.", "", "[^a]: First.", "", "[^a]: Second.", "", "[^z]: Zed."], { line: 0, ch: 13 });
        await deleteFootnote(fakePlugin(merging, doc));
        expect(doc.getValue()).not.toContain("[^z]");
        expect(duplicateAlerts()).toEqual([ONE]);
    });

    it("Convert inline footnotes to normal footnotes", async () => {
        const doc = editor(["One[^a] two^[inline] three.", "", "[^a]: First.", "", "[^a]: Second."]);
        await convertInlineToNormalCommand(fakePlugin(merging, doc));
        expect(doc.getValue()).not.toContain("^[inline]");
        expect(duplicateAlerts()).toEqual([ONE]);
    });

    it("Convert normal footnotes to inline footnotes", async () => {
        const doc = editor(["One[^a] two[^n] three.", "", "[^a]: First.", "", "[^a]: Second.", "", "[^n]: Normal."]);
        await convertNormalToInlineCommand(fakePlugin(merging, doc));
        expect(doc.getValue()).toContain("^[Normal.]");
        expect(duplicateAlerts()).toEqual([ONE]);
    });

    it("a carried paste", () => {
        const doc = editor(["One[^a] two three.", "", "[^a]: First.", "", "[^a]: Second."], { line: 0, ch: 11 });
        paste(fakePlugin({ ...merging, carryFootnotesOnCopy: true }, doc), doc);
        expect(doc.getValue()).toContain("[^p]: Pasted.");
        expect(duplicateAlerts()).toEqual([ONE]);
    });

    it("two footnotes defined twice: the plural, with the same advice", () => {
        noticeLintAlerts(fakePlugin(merging), "x[^a] y[^b]\n\n[^a]: 1\n\n[^a]: 2\n\n[^b]: 3\n\n[^b]: 4", false);
        expect(duplicateAlerts()).toEqual([
            'This note defines 2 footnotes more than once ("[^a]" and "[^b]"). Obsidian renders only each one\'s last definition. Merge them.',
        ]);
    });
});

describe("controls", () => {
    it("with merging off, Delete footnote everywhere names it as before", async () => {
        const doc = editor(["One[^a] two[^z] three.", "", "[^a]: First.", "", "[^a]: Second.", "", "[^z]: Zed."], { line: 0, ch: 13 });
        await deleteFootnote(fakePlugin({ ...merging, lintMergeDuplicateDefinitions: false }, doc));
        expect(duplicateAlerts()).toEqual([TOGGLE_OFF]);
    });

    it("after a lint with merging on, a duplicate the merge would fix stays unnamed (the lint merges it)", () => {
        noticeLintAlerts(fakePlugin(merging), "One[^a] two.\n\n[^a]: First.\n\n[^a]: Second.");
        expect(duplicateAlerts()).toEqual([]);
    });

    it("after a lint with merging on, a copy the merge cannot touch is named as left by the lint", () => {
        noticeLintAlerts(fakePlugin(merging), "One[^a] two.\n\n- [^a]: First.\n\n[^a]: Second.");
        expect(duplicateAlerts()).toEqual([
            'This note defines "[^a]" more than once. Obsidian renders only the last definition. The lint left them as they are, because merging them would change how Obsidian reads the text around them. Merge them by hand.',
        ]);
    });
});
