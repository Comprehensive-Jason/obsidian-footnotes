import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (silent, on default settings): a definition label wedged inside a
// table never gets the alert written for it, because the lint carries it
// out of the table first, along with a row of the table.
//
// What the user would see: a table has "[^1]: x" typed between two of its
// rows. Ruling A2 says the plugin does not move such a label, it tells the
// user. With default settings, the lint instead moves the label to the
// bottom of the note, and "| e | f |" (the row Obsidian folds into the
// definition) goes with it. The table loses a row, a table row ends up at
// the bottom of the note, and the in-table alert, which would have said
// "Move it below the table", never speaks. When the label is already at
// the end of the note, the move puts a blank line above it instead, which
// also takes it out of the table (and leaves "| e | f |" under it), and
// again nothing is said.
//
// Hunt 2026-10-02, round 4, lens alerts. Cluster A1.
//
// Source of truth: ruling A2 (2026-09-15) and the docstring of
// definitionsInsideTableNames in lint-alerts.ts ("The plugin does not move
// the label; it tells the user"); spec-fix-lazy-label-mid-table, whose
// comment says "The in-table alert still names the label so the user can
// decide"; ADR 0002 (the lint is never silent about what it cannot fix).
//
// Severity: medium. The default lint reshapes a table and says nothing.
//
// Cause: the alerts read the note AFTER the lint, and Move definitions to
// bottom (or the blank line it adds above a label that is already last)
// has already taken the label out of the table, so the alert finds nothing
// to name.
//
// Fix (2026-10-06): movedDefinitions (rewrite-document.ts) leaves out a
// definition whose label sits inside a table (labelInsideTable, the
// question the in-table alert asks), so neither move-to-bottom nor reindex
// moves it and the alert finds it after the lint.

/** Lint `doc` with the default settings plus `extra`, then run the alerts on the result, as linter.ts does. */
function lintThenAlerts(doc: string, extra: Record<string, unknown> = {}) {
    const plugin = fakePlugin({ ...DEFAULT_SETTINGS, ...extra });
    const after = lintFootnotes(doc, lintOptionsFromSettings(plugin, "", doc));
    resetNotices();
    noticeLintAlerts(plugin, after);
    return { after, alerts: messages() };
}

beforeEach(resetNotices);

describe("the default lint and the definition-inside-a-table alert", () => {
    it("the A2 fixture, linted with default settings, still gets the in-table alert", () => {
        const { alerts } = lintThenAlerts("| a | b |\n| - | - |\n| c | d |\n[^1]: x\n| e | f |\n\nref[^1]");
        // Before the fix: no in-table alert.
        expect(alerts.some((m) => m.includes('inside a table ("[^1]:")'))).toBe(true);
    });

    it("a label already at the end of the note (reference in a cell) still gets the in-table alert", () => {
        const { alerts } = lintThenAlerts("| a | b |\n| - | - |\n| c[^1] | d |\n[^1]: x\n| e | f |");
        // Before the fix: no in-table alert.
        expect(alerts.some((m) => m.includes('inside a table ("[^1]:")'))).toBe(true);
    });

    it("control: with Move definitions to bottom off the alert speaks", () => {
        const { alerts } = lintThenAlerts("| a | b |\n| - | - |\n| c | d |\n[^1]: x\n| e | f |\n\nref[^1]", {
            lintMoveToBottom: false,
        });
        expect(alerts.some((m) => m.includes('inside a table ("[^1]:")'))).toBe(true);
    });
});
