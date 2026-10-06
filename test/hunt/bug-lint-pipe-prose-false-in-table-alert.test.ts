import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (false alert): a sentence with a "|" in it, under a definition that
// sits right below a table, is taken for a table row, and the lint warns
// that the definition is inside a table.
//
// What the user would see: a table, then "[^1]: x" directly under it, then
// a line of the definition's own text, "where a|b is shorthand". The lint
// alert says the definition is inside a table and tells them to move it
// below the table, which it already is.
//
// Hunt 2026-10-02, round 4, lens alerts. Cluster A2.
//
// Source of truth: the A2 ruling's docstring in lint-alerts.ts (an alert
// for "a table row directly above the label and another directly below
// it"); GFM tables: a table needs a header row and a delimiter row, so a
// lone line after the label cannot be a row of anything. It is the
// footnote's ordinary continuation.
//
// Severity: low. A false alert; nothing in the note changes.
//
// Cause: rowShaped() in lint-alerts.ts counts any line holding a "|" as a
// table row.
//
// Fix (2026-10-06): the line under the label counts as a row only when it
// starts with a pipe where the row above does; a pipe-less table is read as
// before.

/** The lint alerts' toasts for `text` on default settings. */
function alertsOn(text: string) {
    resetNotices();
    noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), text);
    return messages();
}

beforeEach(resetNotices);

describe("a prose line with a pipe under a label below a table", () => {
    it("no in-table alert", () => {
        const text = "| a | b |\n| - | - |\n| c | d |\n[^1]: x\nwhere a|b is shorthand\n\nref[^1]";
        // Before the fix: the in-table alert names [^1].
        expect(alertsOn(text).some((m) => m.includes("inside a table"))).toBe(false);
    });

    it("control: a real row after the label is named", () => {
        const text = "| a | b |\n| - | - |\n| c | d |\n[^1]: x\n| e | f |\n\nref[^1]";
        expect(alertsOn(text).some((m) => m.includes("inside a table"))).toBe(true);
    });
});
