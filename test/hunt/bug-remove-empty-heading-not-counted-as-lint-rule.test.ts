import { describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { lintRulesAllDisabled } from "../../src/linting/linter";

// Bug: with "Remove empty section heading" on and every other lint rule
// off, Lint footnotes said "All lint rules are turned off in the plugin
// settings, so there is nothing to lint." and left the empty heading. The
// README and the setting itself say the lint removes an empty section
// heading, and the lint does remove it once it runs; only the check that
// asks whether any rule is on left this one out.
//
// The setting is greyed out while "Enable section heading" is off, so then
// it does not count, as the punctuation rule does not count under the
// placement "Don't move" (bug-settings-idle-placement-counts-as-lint-on).
//
// Found by the Kimi K3.1 Pro review (2026-11-11); Jason chose to fix it.

const everyRuleOff = {
    lintFixPunctuation: false,
    lintFixLazyDefinitions: false,
    lintMoveToBottom: false,
    lintReindex: false,
    lintApplyPrefix: false,
    enableFootnotePrefix: false,
    lintDeleteOrphanedReferences: false,
    lintDeleteOrphanedDefinitions: false,
    lintMergeDuplicateDefinitions: false,
};

describe("Remove empty section heading counts as a lint rule", () => {
    it("on, with the section heading on: the lint has work to do", () => {
        const plugin = fakePlugin({ ...everyRuleOff, enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes", removeEmptySectionHeading: true });
        expect(lintRulesAllDisabled(plugin)).toBe(false);
    });

    // Characterization: the cases that already counted as all off.
    it("on, but with the section heading off (the toggle is greyed out): every rule is off (as before)", () => {
        const plugin = fakePlugin({ ...everyRuleOff, enableFootnoteSectionHeading: false, removeEmptySectionHeading: true });
        expect(lintRulesAllDisabled(plugin)).toBe(true);
    });

    it("off: every rule is off (as before)", () => {
        const plugin = fakePlugin({ ...everyRuleOff, enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes", removeEmptySectionHeading: false });
        expect(lintRulesAllDisabled(plugin)).toBe(true);
    });
});
