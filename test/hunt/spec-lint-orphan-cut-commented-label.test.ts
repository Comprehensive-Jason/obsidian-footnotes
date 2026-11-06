import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// Jason's ruling, 2026-11-05: Delete orphaned references leaves alone a
// reference whose definition the user wrote but hid in a %% comment, and the
// label in the comment too. This is the lazy label's exemption: the user
// wrote the definition, so deleting the reference would throw their work
// away. The alert that says "Move it out of the comment" then speaks.
//
// What it did before: "text[^k] here" and a %% block comment holding
// "[^k]: hidden", with the setting on, came back as "text here" and
// ": hidden". The name was gone, so the alert never spoke. With the setting
// off, one footnote got two alerts with opposite advice ("Write its
// definition or delete the reference" and "Move it out of the comment").
//
// Hunt 2026-10-02, round 4, lens alerts. Cluster A9. Entry 2 of the spec sort
// of 2026-11-05.
//
// Source of truth: Jason's ruling above; ruling A1 (2026-09-15), which names
// the commented label in an alert; the lazy-label comment in
// remove-orphaned-references.ts (2026-09-09); ADR 0002.

const NOTE = "text[^k] here\n\n%%\n[^k]: hidden\n%%\n";
const ALERT = 'This note has a footnote definition inside a comment ("[^k]:"), where Obsidian never shows it. Move it out of the comment.';

/** The plugin with the default settings plus `extra`. */
function pluginWith(extra: Record<string, unknown>) {
    return fakePlugin({ ...DEFAULT_SETTINGS, ...extra });
}

/** Lint `doc` with the default settings plus `extra`. */
function lint(doc: string, extra: Record<string, unknown>): string {
    return lintFootnotes(doc, lintOptionsFromSettings(pluginWith(extra), "", doc));
}

beforeEach(resetNotices);

describe("a definition misplaced in a %% comment and orphan deletion (Jason's ruling, 2026-11-05)", () => {
    it("Delete orphaned references keeps the commented label and the reference it would serve", () => {
        expect(lint(NOTE, { lintDeleteOrphanedReferences: true })).toBe(NOTE);
    });

    it("keeps a commented label that no reference in the text points at", () => {
        const note = "text\n\n%%\n[^k]: hidden\n%%\n";
        expect(lint(note, { lintDeleteOrphanedReferences: true })).toBe(note);
    });

    it("with the setting on, the alert that says to move it out of the comment speaks", () => {
        noticeLintAlerts(pluginWith({ lintDeleteOrphanedReferences: true }), NOTE);
        expect(messages()).toEqual([ALERT]);
    });

    it("with the setting off, that alert speaks alone, with no advice to write a definition", () => {
        noticeLintAlerts(pluginWith({ lintDeleteOrphanedReferences: false }), NOTE);
        expect(messages()).toEqual([ALERT]);
    });

    it("control: a reference with no definition anywhere is still deleted", () => {
        const note = "text[^k] here[^gone]\n\n%%\n[^k]: hidden\n%%\n";
        expect(lint(note, { lintDeleteOrphanedReferences: true })).toBe(NOTE);
    });
});
