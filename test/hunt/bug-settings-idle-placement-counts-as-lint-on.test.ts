import { beforeEach, describe, expect, it } from "vitest";

import { lintAfterFootnoteCreation, lintRulesAllDisabled } from "../../src/linting/linter";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { noticeCalls } from "../mocks/obsidian";

// BUG (annoyance): with Placement set to "Don't move" and every other lint
// rule switched off, the plugin still treats linting as on.
//
// What the user would see: under "Don't move" the settings page greys out
// "Fix footnote reference placement", and the README says the rule then
// does nothing. The user switches every other lint rule off, expecting
// linting to be off. It is not: the lint alerts still speak after each new
// footnote (here the orphan alert about an unrelated "[^9]"), exactly as
// they would with rules on. With every rule truly off they stay silent.
//
// Hunt 2026-10-02, round 4, lens settings. Cluster S1.
//
// Source of truth: settings.ts greys the placement toggle because "under
// Don't move the rule is idle" (Jason, 2026-09-21); README "Under Don't
// move the rule does nothing"; and lintRulesAllDisabled's own contract
// ("when every rule is off, lint is off, and the alerts deliberately stay
// silent too"). Its sibling test in test/empty-reference-lint-alert.test.ts
// already treats a rule made idle by another setting as off (apply-prefix
// only counts while the prefix feature is on).
//
// Severity: low. Nothing in the note changes; the user gets alerts they
// switched off.
//
// Cause: lintRulesAllDisabled reads the placement toggle
// (lintFixPunctuation) on its own and never asks whether Placement is
// "Don't move".

/** Every lint rule except the placement one switched off. */
const everyOtherRuleOff = {
    lintFixLazyDefinitions: false,
    lintMoveToBottom: false,
    lintReindex: false,
    lintApplyPrefix: false,
    enableFootnotePrefix: false,
    lintDeleteOrphanedReferences: false,
    lintDeleteOrphanedDefinitions: false,
    lintMergeDuplicateDefinitions: false,
};

beforeEach(resetNotices);

describe("Placement \"Don't move\" with every other lint rule off", () => {
    it.fails("lintRulesAllDisabled counts the idle (greyed) placement rule as off", () => {
        const plugin = fakePlugin({ ...everyOtherRuleOff, footnotePlacement: "none", lintFixPunctuation: true });
        // Today: false.
        expect(lintRulesAllDisabled(plugin)).toBe(true);
    });

    it.fails("lint on footnote creation stays silent, as it does with every rule off", () => {
        const lines = ["text[^1] here", "", "[^1]: used", "[^9]: stray"];
        const doc = fakeEditor(lines, { cursor: { line: 0, ch: 4 }, edits: true, wholeDoc: true });
        const plugin = fakePlugin(
            { ...everyOtherRuleOff, footnotePlacement: "none", lintFixPunctuation: true, lintOnFootnoteCreation: true },
            doc,
        );
        lintAfterFootnoteCreation(plugin, doc, false);
        // Today: one notice, the orphan alert naming [^9].
        expect(noticeCalls).toEqual([]);
    });
});
