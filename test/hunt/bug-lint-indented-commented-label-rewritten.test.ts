import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (wrong output on default settings): a definition label hidden in a
// %% comment that is indented inside another definition gets rewritten by
// the lint, and the alert for commented definitions misses it.
//
// What the user would see: under "[^a]: x" they wrote an indented %%
// comment (four spaces, so it belongs to footnote a) holding "[^k]: y", a
// definition they parked there. The default lint changes the hidden line
// to ":[^k] y", moving the reference past the colon as if it were a
// reference in prose. The alert that names a definition inside a %%
// comment and tells the user to move it out says nothing. The same label
// at the left margin is left alone and named (the control).
//
// Hunt 2026-10-02, round 4, lens alerts. Cluster A3.
//
// Needs a Reading-view check: "use[^a]", a blank line, "[^a]: x", then
// "    %%", "    [^k]: y", "    %%". Confirm Obsidian hides the comment
// (as the plugin's scan does, commit 7a6583d: a region opened inside a
// definition's continuation keeps running), so that the rewrite really
// edits hidden text.
//
// Source of truth: ruling A1 (2026-09-15): a definition inside a %% block
// comment is left as written and named by its alert, as the column-0 twin
// is; ADR 0002 (the lint is never silent about what it cannot fix).
//
// Severity: low. A rare shape, but the lint edits text the user hid on
// purpose.
//
// Cause: the commented-definition alert reads labels with at most three
// columns of indent (definitionLabelWithName), so a four-column label is
// not a label to it, and the punctuation rule then treats "[^k]" as a
// reference followed by a colon.
//
// The lint half is fixed (2026-10-05, round 2's cluster L5, pin
// bug-punctuation-wide-item-label): the punctuation rule reads a label
// from where the line's containers end, here past the definition's four
// columns, so it steps over "[^k]:". The alert half is fixed too
// (2026-10-06, round 2's cluster L11): the commented-definition alert
// reads a label from where the line's containers end as well.

/** Lint `doc` on default settings, then run the alerts on the result, as linter.ts does. */
function lintThenAlerts(doc: string) {
    const plugin = fakePlugin({ ...DEFAULT_SETTINGS });
    const after = lintFootnotes(doc, lintOptionsFromSettings(plugin, "", doc));
    resetNotices();
    noticeLintAlerts(plugin, after);
    return { after, alerts: messages() };
}

/** The lint alerts' toasts for `text` on default settings. */
function alertsOn(text: string) {
    resetNotices();
    noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), text);
    return messages();
}

beforeEach(resetNotices);

describe("a commented label inside a definition's indented %% block", () => {
    const DOC = "use[^a]\n\n[^a]: x\n    %%\n    [^k]: y\n    %%\n";

    it("the default lint leaves the hidden label as written", () => {
        // Before the fix: the hidden line became "    :[^k] y".
        expect(lintThenAlerts(DOC).after).toBe(DOC);
    });

    it("the commented-definition alert names it", () => {
        // Before the fix, no such alert.
        expect(alertsOn(DOC).some((m) => m.includes('inside a %% comment ("[^k]:")'))).toBe(true);
    });

    it("control: the column-0 twin is left alone and named", () => {
        const doc = "use[^a]\n\n%%\n[^k]: y\n%%\n\n[^a]: x\n";
        const { after, alerts } = lintThenAlerts(doc);
        expect(after).toBe(doc);
        expect(alerts.some((m) => m.includes('inside a %% comment ("[^k]:")'))).toBe(true);
    });
});
