// Imported from the Kimi K3 cycle 2 hunt of 2026-09-16 (OpenCode worktree); 1 of 2 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { noticeCalls } from "../mocks/obsidian";
import { resetNotices } from "../helpers/notices";

import { lintAfterFootnoteCreation } from "../../src/linting/linter";

// The lint's off-state contract, in linter.ts's own words: "when every
// rule is off, lint is off, and the alerts deliberately stay silent too."
// The Lint footnotes command honors it ("All lint rules are turned off in
// the plugin settings, so there is nothing to lint."), and the
// lint-on-save trigger honors it (lintActiveNoteIfSafe checks
// lintRulesAllDisabled first).
//
// The lint-on-footnote-creation trigger does not: lintAfterFootnoteCreation
// runs the alerts (noticeLintAlerts) even when every rule and every toggle
// is off, so creating a footnote in that state toasts orphaned-definition
// and missing-reference warnings from a lint that is supposed to be off.
//
// What the user sees: they turned every lint rule off, and every footnote
// they create still pops lint warnings about their note.
//
// Source of truth: the lintRulesAllDisabled contract comment in
// src/linting/linter.ts + the two triggers that honor it (sheet 12's
// "nothing to lint" check).
//
// Settings involved: every lint rule OFF, `Lint on footnote creation` ON.

describe("lint on footnote creation with every lint rule off", () => {
    beforeEach(resetNotices);

    it("stays silent, like the command and the save trigger do", () => {
        const lines = ["text[^1] here", "", "[^1]: used", "[^9]: stray"];
        const doc = fakeEditor(lines, {
            cursor: { line: 0, ch: 4 },
            edits: true,
            wholeDoc: true,
        });
        const plugin = fakePlugin(
            {
                lintOnFootnoteCreation: true,
                lintFixPunctuation: false,
                lintFixLazyDefinitions: false,
                lintMoveToBottom: false,
                lintReindex: false,
                lintApplyPrefix: false,
                enableFootnotePrefix: false,
                lintDeleteOrphanedReferences: false,
                lintDeleteOrphanedDefinitions: false,
                lintMergeDuplicateDefinitions: false,
            },
            doc,
        );
        lintAfterFootnoteCreation(plugin, doc, false);
        expect(noticeCalls).toEqual([]);
    });

    it("control: with a rule ON the same creation does alert", () => {
        const lines = ["text[^1] here", "", "[^1]: used", "[^9]: stray"];
        const doc = fakeEditor(lines, {
            cursor: { line: 0, ch: 4 },
            edits: true,
            wholeDoc: true,
        });
        const plugin = fakePlugin(
            {
                lintOnFootnoteCreation: true,
                lintFixPunctuation: true,
            },
            doc,
        );
        lintAfterFootnoteCreation(plugin, doc, false);
        expect(noticeCalls.some((args) => String(args[0]).includes("nothing references"))).toBe(true);
    });
});
