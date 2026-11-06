import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import {
    orphanedFootnoteReferenceNames,
    removeOrphanedFootnoteReferences,
} from "../../src/linting/rules/remove-orphaned-references";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// A backslash-escaped "]" inside what looks like a footnote name, as in
// "[^a\]b]". The live check of 2026-11-05 on Obsidian 1.15.0 settled how it
// reads: Obsidian reads neither "Alpha[^a\]b]." nor "[^a\]b]: body" as a
// footnote, so both are plain text.
//
// The note reading stops the name at the first "]", so it sees a reference
// named "a\" and the rest of the line, "b]", as text. With Delete orphaned
// references on, the lint cut "[^a\]" out of the prose, leaving "Alphab]." and
// "b]: body". That destroys plain text, so the rule now leaves alone any name
// ending in a backslash (Jason's ruling, 2026-11-05). The alert leaves it alone
// too, because to Obsidian this is no footnote with a missing definition.
//
// Hunt: 2026-09-13. Lens: grammar. Entry 4 of the spec sort of 2026-11-05.
//
// Source of truth: the live check above; the plugin's own policy in
// src/linting/rules/remove-orphaned-references.ts that a deletion must never
// destroy ordinary prose.

const NOTE = "Alpha[^a\\]b].\n\n[^a\\]b]: body\n";

const settings = { ...DEFAULT_SETTINGS, lintDeleteOrphanedReferences: true };

beforeEach(resetNotices);

describe("an escaped ] inside a name (Jason's ruling, 2026-11-05, from the live check on Obsidian 1.15.0)", () => {
    it("orphan deletion does not chop a [^a\\]b]: line in half", () => {
        const before = "Alpha.\n\n[^a\\]b]: body\n";
        expect(removeOrphanedFootnoteReferences(before)).toBe(before);
    });

    it("orphan deletion leaves the prose and the line that looks like a definition", () => {
        expect(removeOrphanedFootnoteReferences(NOTE)).toBe(NOTE);
    });

    it("a whole lint with Delete orphaned references on leaves them too", () => {
        expect(lintFootnotes(NOTE, lintOptionsFromSettings(fakePlugin(settings), "", NOTE))).toBe(NOTE);
    });

    it("no alert calls it a reference with no definition", () => {
        expect(orphanedFootnoteReferenceNames(NOTE)).toEqual([]);
        noticeLintAlerts(fakePlugin({ ...settings, lintDeleteOrphanedReferences: false }), NOTE);
        expect(messages().filter((m) => m.includes("no definition"))).toEqual([]);
    });

    it("control: a backslash anywhere else in the name is an orphan like any other", () => {
        expect(removeOrphanedFootnoteReferences("Alpha[^a\\b].\n")).toBe("Alpha.\n");
    });
});
