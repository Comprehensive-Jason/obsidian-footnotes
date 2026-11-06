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

// A backslash in front of a "]" in what looks like a footnote name, as in
// "[^a\]b]". Reading view on Obsidian 1.15.0 (2026-11-06) draws "[^a\]" as a
// reference with no definition, shown bare as "a\", and then the text "b]". The
// note reading agrees. The metadata cache lists no reference there only because
// it lists defined ones, which is why the check of 2026-11-05 took this for plain
// text and no footnote: that evidence was wrong.
//
// With Delete orphaned references on, the lint cut "[^a\]" out of the text,
// leaving "Alphab]." and "b]: body". The rule leaves alone any name ending in a
// backslash, and so does the alert (Jason's ruling, 2026-11-05). That still holds
// on the corrected evidence, because it protects prose such as a regex written
// outside code, where the cut would destroy what the user wrote.
//
// Hunt: 2026-09-13. Lens: grammar. Entry 4 of the spec sort of 2026-11-05. The
// evidence corrected in hunt 2026-11-06, cycle 9.
//
// Source of truth: the live answers above (H10a, H10b, H10d); the plugin's own
// policy in src/linting/rules/remove-orphaned-references.ts that a deletion must
// never destroy ordinary prose.

const NOTE = "Alpha[^a\\]b].\n\n[^a\\]b]: body\n";

const settings = { ...DEFAULT_SETTINGS, lintDeleteOrphanedReferences: true };

beforeEach(resetNotices);

describe("a name ending in a backslash (Jason's ruling, 2026-11-05; the evidence corrected 2026-11-06)", () => {
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

    it("a regex written outside code stays whole, which is what the exemption is for", () => {
        const note = "Use the regex [^\\]]+ here.\n";
        expect(removeOrphanedFootnoteReferences(note)).toBe(note);
    });

    it("control: a backslash anywhere else in the name is an orphan like any other", () => {
        expect(removeOrphanedFootnoteReferences("Alpha[^a\\b].\n")).toBe("Alpha.\n");
    });
});
