import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";
import { resetNotices } from "./helpers/notices";
import { noticeCalls } from "./mocks/obsidian";

import { lintAfterFootnoteCreation, lintFootnotes, lintNote, lintOptionsFromSettings } from "../src/linting/linter";
import { reIndexFootnotesRule } from "../src/linting/rules/re-index-footnotes";

// lintNote skips a lint whose input is exactly the text the last lint
// produced with the same options, since the lint settles a note in one run
// (the speed brief, item 5, 2026-10-05). These tests watch the reindex
// rule, which runs on every lint with the default settings, to tell a lint
// that ran from one that was skipped. Each test uses a note of its own,
// since the last result is remembered across tests.

/** A watch on the reindex rule: how many times the lint ran it. */
const watchReindex = () => vi.spyOn(reIndexFootnotesRule, "apply");

describe("a lint of the lint's own last result is skipped", () => {
    let reindex: ReturnType<typeof watchReindex>;
    beforeEach(() => {
        resetNotices();
        reindex = watchReindex();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("the second lint runs no rule and gives the text back unchanged", () => {
        const plugin = fakePlugin({});
        const linted = lintNote(plugin, "Second[^2] then first.[^1] (memo one)\n\n[^1]: one\n[^2]: two", "");
        expect(linted).toBe("Second[^1] then first.[^2] (memo one)\n\n[^1]: two\n[^2]: one");
        expect(reindex).toHaveBeenCalledTimes(1);
        expect(lintNote(plugin, linted, "")).toBe(linted);
        expect(reindex).toHaveBeenCalledTimes(1);
    });

    it("the result is the one a full lint gives", () => {
        const plugin = fakePlugin({});
        const linted = lintNote(plugin, "Text.[^b] [^a] (memo two)\n\n[^a]: a\n[^b]: b", "");
        expect(lintNote(plugin, linted, "")).toBe(lintFootnotes(linted, lintOptionsFromSettings(plugin, "", linted)));
    });

    it("any change to the text runs the lint again", () => {
        const plugin = fakePlugin({});
        const linted = lintNote(plugin, "Some text.[^1] (memo three)\n\n[^1]: one", "");
        expect(reindex).toHaveBeenCalledTimes(1);
        lintNote(plugin, `${linted}\n`, "");
        expect(reindex).toHaveBeenCalledTimes(2);
    });

    it("a changed lint setting runs the lint again on the same text", () => {
        const plugin = fakePlugin({ lintFixPunctuation: true });
        const linted = lintNote(plugin, "Some text[^1]. (memo four)\n\n[^1]: one", "");
        expect(reindex).toHaveBeenCalledTimes(1);
        plugin.settings.lintFixPunctuation = false;
        lintNote(plugin, linted, "");
        expect(reindex).toHaveBeenCalledTimes(2);
    });

    it("another section heading runs the lint again on the same text", () => {
        const plugin = fakePlugin({});
        const linted = lintNote(plugin, "Some text.[^1] (memo five)\n\n[^1]: one", "");
        lintNote(plugin, linted, "# Notes");
        expect(reindex).toHaveBeenCalledTimes(2);
    });

    it("a skipped lint still shows its alerts (ADR 0002: the lint is never silent)", () => {
        const lines = ["text[^1] here (memo six)", "", "[^1]: used", "[^9]: stray"];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 4 }, edits: true, wholeDoc: true });
        // the fake's settings start empty, which reads as every rule off, so one is named
        const plugin = fakePlugin({ lintOnFootnoteCreation: true, lintReindex: true }, doc);
        const stray = () => noticeCalls.some((args) => String(args[0]).includes("nothing references"));
        lintAfterFootnoteCreation(plugin, doc, false);
        expect(stray()).toBe(true);
        expect(reindex).toHaveBeenCalledTimes(1);
        resetNotices();
        lintAfterFootnoteCreation(plugin, doc, false);
        expect(reindex).toHaveBeenCalledTimes(1);
        expect(stray()).toBe(true);
    });
});

// A lint the result gate refuses as a whole runs twice: once with every
// change passed, then again with every change judged (gatedLint in
// rule-gate.ts). lintNote remembers, next to its last result, that the
// note's last lint needed that second run, and the next lint of the same
// note goes straight to it (Jason's pick, decision 1 of the stage 3
// report, 2026-10-08). The reindex rule runs once per run, so these tests
// count runs with it, and each test lints texts of its own, since a lint
// of the last lint's own result is skipped.
describe("a note whose last lint held something back is linted checked at once", () => {
    let reindex: ReturnType<typeof watchReindex>;
    beforeEach(() => {
        resetNotices();
        reindex = watchReindex();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** A plugin whose open note is the file at `path`, with the orphan rule on. */
    const pluginIn = (path: string) => {
        const plugin = fakePlugin({ lintDeleteOrphanedDefinitions: true, lintReindex: true });
        (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ file: { path } }) };
        return plugin;
    };
    // the orphan rule may not cut "[^zz]: stray": the two lists around it would join
    const held = (word: string) => `1. one ${word}\n\n[^zz]: stray\n\n3. three\n\nText[^1] here.\n\n[^1]: one`;

    it("the first lint of a note that holds back runs twice", () => {
        const plugin = pluginIn("memo held one.md");
        expect(lintNote(plugin, held("one"), "")).toContain("[^zz]: stray");
        expect(reindex).toHaveBeenCalledTimes(2);
    });

    it("the next lint of the same note runs once, and gives what a full lint gives", () => {
        const plugin = pluginIn("memo held two.md");
        lintNote(plugin, held("two a"), "");
        reindex.mockClear();
        const linted = lintNote(plugin, held("two b"), "");
        expect(reindex).toHaveBeenCalledTimes(1);
        expect(linted).toBe(lintFootnotes(held("two b"), lintOptionsFromSettings(plugin, "", held("two b"))));
    });

    it("another note does not inherit it", () => {
        lintNote(pluginIn("memo held three.md"), held("three a"), "");
        reindex.mockClear();
        lintNote(pluginIn("memo held four.md"), held("three b"), "");
        expect(reindex).toHaveBeenCalledTimes(2);
    });

    it("once the note holds nothing back, its lints go back to one gathered run", () => {
        const plugin = pluginIn("memo held five.md");
        lintNote(plugin, held("five a"), "");
        // the stray definition is gone, so nothing is held back
        const clean = (word: string) => `1. one ${word}\n\nText[^1] here.\n\n[^1]: one`;
        lintNote(plugin, clean("five b"), "");
        reindex.mockClear();
        lintNote(plugin, held("five c"), "");
        expect(reindex).toHaveBeenCalledTimes(2);
    });
});
