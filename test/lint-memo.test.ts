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
