import { beforeEach, describe, expect, it } from "vitest";

import FootnotePlugin from "../src/main";
import { DEFAULT_SETTINGS, FootnotePluginSettingTab } from "../src/settings";
import { insertAutonumFootnote } from "../src/commands/insert-or-navigate-footnotes";
import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

// Manual sheet 12, "lint triggers and the Linting settings page". Most of
// its trigger boxes are already driven by the smoke suite in a real
// Obsidian, and the Linting page is described by getSettingDefinitions(),
// which is a plain data structure a test can read.
//
// This file replaces these boxes of sheet 12:
//   the first box of "Lint on footnote creation": inserting a footnote into
//     the sheet's own messy fixture renumbers the note and says
//     "Footnotes linted."
//   the "Orphans and duplicates" box: the group's position, its three
//     toggles, and their OFF defaults
//   the "Rules" box: the group's four toggles
//   the "Renumber named footnotes is greyed out" box
//   the "Apply the note's footnote prefix is greyed out" box, including
//     the tail saying the Orphans toggles are never greyed
//
// What stays on the sheet: the undo-in-one-step half of the Ctrl+S box,
// the fold-and-caret box on save, the "switching notes never lints" box,
// the all-rules-off toast (raised from main.ts and from the save hook,
// where neither layer can reach it), and the housekeeping line about
// putting the settings back.

// ---------- lint on footnote creation ----------

// the sheet's messy fixture: the references are out of order, so any lint
// renumbers them to [^1] and [^2]
const MESSY = [
    "start messy[^20] references[^10] here",
    "",
    "[^20]: twenty, used first",
    "[^10]: ten, used second",
];

beforeEach(resetNotices);

describe("sheet 12: inserting a footnote with 'Lint on footnote creation' on", () => {
    it("renumbers the whole note and announces it", async () => {
        // caret inside the word "start", so the new reference lands first
        // in reading order and the lint has to renumber everything
        const doc = fakeEditor(MESSY, {
            cursor: { line: 0, ch: 2 },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(
            fakePlugin(
                {
                    insertAtEndOfWord: true,
                    enablePopupEditor: false,
                    lintOnFootnoteCreation: true,
                    lintFixPunctuation: true,
                    lintFixLazyDefinitions: true,
                    lintMoveToBottom: true,
                    lintReindex: true,
                },
                doc,
            ),
        );
        expect(doc.lines).toEqual([
            "start[^1] messy[^2] references[^3] here",
            "",
            "[^1]: ",
            "[^2]: twenty, used first",
            "[^3]: ten, used second",
        ]);
        expect(messages()).toContain("Footnotes linted.");
    });
});

// ---------- the Linting settings page ----------

// getSettingDefinitions() hands back the page as data: rows, groups of
// rows, and sub-pages. These helpers read that tree the way the settings
// screen renders it, so the tests can ask about order, membership, and
// which controls are greyed out.
interface DefinitionNode {
    type?: string;
    heading?: string;
    name?: string;
    items?: DefinitionNode[];
    control?: { type: string; key: string; disabled?: () => boolean };
}

function lintingPage(settings: Partial<FootnotePlugin["settings"]> = {}): DefinitionNode[] {
    const app = { plugins: { plugins: {} } };
    const plugin = { settings: { ...DEFAULT_SETTINGS, ...settings } } as unknown as FootnotePlugin;
    const tab = new FootnotePluginSettingTab(app as never, plugin);
    // the mocked PluginSettingTab base does no constructor wiring
    Object.assign(tab, { app, plugin });
    const page = (tab.getSettingDefinitions() as DefinitionNode[]).find(
        (item) => item.type === "page" && item.name === "Linting",
    );
    expect(page).toBeDefined();
    return page?.items ?? [];
}

const groupsOf = (items: DefinitionNode[]) =>
    items.filter((item) => item.type === "group");

function group(items: DefinitionNode[], heading: string): DefinitionNode {
    const found = groupsOf(items).find((item) => item.heading === heading);
    expect(found).toBeDefined();
    return found as DefinitionNode;
}

const controlOf = (node: DefinitionNode, name: string) =>
    node.items?.find((item) => item.name === name)?.control;

describe("sheet 12: the Orphans and duplicates group", () => {
    const items = lintingPage();

    it("sits between Rules and Reindexing", () => {
        expect(groupsOf(items).map((item) => item.heading)).toEqual([
            "Rules",
            "Orphans and duplicates",
            "Reindexing",
        ]);
    });

    it("holds exactly the three orphan and duplicate toggles", () => {
        expect(group(items, "Orphans and duplicates").items?.map((item) => item.name)).toEqual([
            "Delete orphaned references",
            "Delete orphaned definitions",
            "Merge duplicate definitions",
        ]);
    });

    it("all three are off by default, so the lint alerts about that kind instead", () => {
        expect(DEFAULT_SETTINGS.lintDeleteOrphanedReferences).toBe(false);
        expect(DEFAULT_SETTINGS.lintDeleteOrphanedDefinitions).toBe(false);
        expect(DEFAULT_SETTINGS.lintMergeDuplicateDefinitions).toBe(false);
    });
});

describe("sheet 12: the Rules group", () => {
    const items = lintingPage();

    it("holds four toggles: punctuation, move definitions, the hidden-definition fix, and the prefix rule", () => {
        expect(group(items, "Rules").items?.map((item) => item.name)).toEqual([
            // renamed with the placement setting (T5, 2026-09-21): the rule
            // now follows the setting, so "after" no longer belongs in its name
            "Fix footnote reference placement",
            "Move definitions to the footnote section",
            "Fix definitions hidden by a missing blank line",
            "Apply the note's footnote prefix",
        ]);
    });

    it("the hidden-definition fix is on by default, and says it alerts while off", () => {
        expect(DEFAULT_SETTINGS.lintFixLazyDefinitions).toBe(true);
    });
});

describe("sheet 12: which controls are greyed out", () => {
    // Jason, 2026-09-21: under Don't move the placement rule can do
    // nothing, so its toggle is greyed out rather than left looking live
    it("Fix footnote reference placement is greyed while the placement is Don't move, and live otherwise", () => {
        const rules = (placement: "after" | "before" | "none") =>
            controlOf(group(lintingPage({ footnotePlacement: placement }), "Rules"), "Fix footnote reference placement");
        expect(rules("none")?.disabled?.()).toBe(true);
        expect(rules("after")?.disabled?.()).toBe(false);
        expect(rules("before")?.disabled?.()).toBe(false);
    });

    it("the Reindexing group holds only the Reindex toggle now: naming moved to the main page's Preferred footnote naming style dropdown (2026-09-22)", () => {
        expect(group(lintingPage(), "Reindexing").items?.map((item) => item.name)).toEqual(["Reindex"]);
    });

    it("Apply the note's footnote prefix is greyed while the prefix feature is off", () => {
        const off = group(lintingPage({ enableFootnotePrefix: false }), "Rules");
        expect(controlOf(off, "Apply the note's footnote prefix")?.disabled?.()).toBe(true);
        const on = group(lintingPage({ enableFootnotePrefix: true }), "Rules");
        expect(controlOf(on, "Apply the note's footnote prefix")?.disabled?.()).toBe(false);
    });

    it("the three Orphans and duplicates toggles are never greyed, whatever else is off", () => {
        const orphans = group(
            lintingPage({ lintReindex: false, enableFootnotePrefix: false }),
            "Orphans and duplicates",
        );
        for (const item of orphans.items ?? []) {
            expect(item.control?.disabled).toBeUndefined();
        }
    });
});
