// BUG (annoyance): every lint alerts on a reference that sits in front of
// an email address's full stop, where Jason's ruling Q30 puts it.
//
// What the user would see: "Write to me@example.com[^1]." with the
// default settings. The numbered key wrote the reference there (Q30: in
// front of the full stop, so the full stop is not taken into the address's
// link). Every lint then shows "This note has a footnote reference the lint
// could not move to the other side of its punctuation ("[^1]"), and the
// lint left it in place, because moving it would change how Obsidian reads
// the lines around it." The note is right as it is. The same in a list
// item, a quote, and a table cell.
//
// Hunt 2026-10-09, cycle 8. Cluster V13, lens the lint.
// Source of truth: ruling Q30 (2026-10-08) and rule D8; pin
// spec-press-after-email-period.
// Origin: pre-existing (red at 34d5377 and 3a47f7a): Q30 (ebc9450) was
// applied to the press only, not to the lint's punctuation rule.

// Hunt cycle 8 (the lint), lead 2: the punctuation rule's held
// alert on a note in the state Jason's ruling Q30 (2026-10-08) asks for.
// Under After, a press at the end of "Write to me@example.com." lands in
// front of the period, "Write to me@example.com[^1].", because Obsidian
// lets an email link take a period that text follows (rule D8; live
// answers c6:z17-email-ref and c6:z17-email-before; pin
// spec-press-after-email-period). The default lint then tries to move the
// reference past the period, the result gate refuses (the link would take
// the period), and every lint of the note shows "This note has a footnote
// reference the lint could not move to the other side of its punctuation
// ("[^1]")...", on a note the plugin's own press wrote and that is where
// the ruling puts it. Fix-shape neutral: the note stays as it is, and no
// alert names the reference.
import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { lintNote } from "../../src/linting/linter";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS, FootnotePluginSettings } from "../../src/settings";

/** Lints `text` as the plugin does with the default settings plus `settings`, shows the alerts, and returns both. */
function alertsAfterLint(text: string, settings: Partial<FootnotePluginSettings> = {}) {
    const plugin = fakePlugin({ ...DEFAULT_SETTINGS, ...settings });
    const linted = lintNote(plugin, text, "");
    resetNotices();
    noticeLintAlerts(plugin, linted);
    return { linted, alerts: messages() };
}

const Held = "could not move to the other side of its punctuation";

beforeEach(resetNotices);

describe("the lint and a reference in front of an email address's period (ruling Q30)", () => {
    it("After, the default lint: the note stays, and no alert names the reference", () => {
        const note = "Write to me@example.com[^1].\n\n[^1]: Office hours only.";
        const { linted, alerts } = alertsAfterLint(note);
        expect(linted).toBe(note);
        expect(alerts.filter((alert) => alert.includes(Held))).toEqual([]);
    });

    it("After, in a table cell: the note stays, and no alert names the reference", () => {
        const note = "| Contact |\n| --- |\n| Write to me@example.com[^1]. |\n\n[^1]: Office hours only.";
        const { linted, alerts } = alertsAfterLint(note);
        expect(linted).toBe(note);
        expect(alerts.filter((alert) => alert.includes(Held))).toEqual([]);
    });

    it("control: Before, the same note stays and nothing is said", () => {
        const note = "Write to me@example.com[^1].\n\n[^1]: Office hours only.";
        const { linted, alerts } = alertsAfterLint(note, { footnotePlacement: "before" });
        expect(linted).toBe(note);
        expect(alerts).toEqual([]);
    });

    it("control: After, a plain word before the period moves past it, and nothing is said", () => {
        const { linted, alerts } = alertsAfterLint("Write to the office[^1].\n\n[^1]: Office hours only.");
        expect(linted).toBe("Write to the office.[^1]\n\n[^1]: Office hours only.");
        expect(alerts).toEqual([]);
    });
});
