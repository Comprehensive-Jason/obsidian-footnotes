import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// A label typed in the middle of a paragraph, which nothing references, with more
// lines of the paragraph under it: "Prose above.", "[^7]: typed here", "Next line of
// prose." Obsidian reads all three lines as one paragraph.
//
// What the user lost: Fix definitions hidden by a missing blank line (on by default)
// turned the next lines into the footnote's text, and Delete orphaned definitions
// deleted them with it, in one lint and with no alert. Lines Obsidian was showing as
// prose were gone.
//
// Hunt 2026-11-06, cycle 9, finding H13. Severity: data loss, rare. Origin:
// pre-existing.
//
// Source of truth: the triage of cycle 9: the label stays lazy when nothing
// references it and paragraph lines follow it, so the lazy alert names it. The scope
// rule of 2026-10-07 (data loss in any shape) and ADR 0002 (never silent). The ruling
// that the rest of the label's paragraph is the definition's text (Q24, list B) still
// holds for a label something references.

const On = { lintDeleteOrphanedDefinitions: true };
const Lazy = (label: string) => `Obsidian reads "${label}:" as plain text, not as a footnote definition. Put a blank line above it.`;

const pluginWith = (extra: Partial<typeof DEFAULT_SETTINGS> = {}) => fakePlugin({ ...DEFAULT_SETTINGS, ...extra });
const lint = (note: string, extra: Partial<typeof DEFAULT_SETTINGS> = {}) => lintFootnotes(note, lintOptionsFromSettings(pluginWith(extra), "", note));

beforeEach(resetNotices);

describe("prose under a lazy label nothing references", () => {
    it.each([
        ["one line of prose", "Prose above.\n[^7]: typed here\nNext line of prose."],
        ["several lines, with a reference among them", "Prose above.\n[^7]: typed here\nNext line[^1] of prose.\nAnd one more.\n\n[^1]: one"],
        ["in a quote", "> Prose above.\n> [^7]: typed here\n> Next line of prose."],
        ["in a list item", "- Prose above.\n  [^7]: typed here\n  Next line of prose."],
        ["cited only by a definition nothing references", "Prose above.\n[^7]: typed here\nNext line of prose.\n\n[^8]: cites[^7]"],
        ["with a lazy label below it that takes the prose", "Prose above.\n[^7]: one\n[^8]: two\nNext line of prose."],
    ])("%s: the note survives a lint with Delete orphaned definitions on", (_label, note) => {
        expect(lint(note, On)).toContain("Next line");
    });

    it("the label stays lazy, whether or not the deletion is on", () => {
        const note = "Prose above.\n[^k]: typed here\nNext line of prose.";
        expect(lint(note, On)).toBe(note);
        expect(lint(note)).toBe(note);
    });

    it("the lazy alert names it, and nothing else speaks", () => {
        noticeLintAlerts(pluginWith(On), "Prose above.\n[^7]: typed here\nNext line of prose.");
        expect(messages()).toEqual([Lazy("[^7]")]);
    });

    it("a second lint changes nothing", () => {
        const once = lint("Prose above.\n[^7]: one\n[^8]: two\nNext line of prose.", On);
        expect(lint(once, On)).toBe(once);
    });
});

describe("controls", () => {
    it("a label with nothing under it is fixed and goes, as the setting says", () => {
        expect(lint("Prose above.\n[^7]: typed here", On)).toBe("Prose above.");
    });

    it("a blank line under the label ends its text, so the label is fixed and goes", () => {
        expect(lint("Prose above.\n[^7]: typed here\n\nNext paragraph.", On)).toBe("Prose above.\n\nNext paragraph.");
    });

    it("a label something references still takes the rest of its paragraph as its text (ruling Q24, list B)", () => {
        expect(lint("Prose[^k] above.\n[^k]: typed here\nNext line.", On)).toBe("Prose[^k] above.\n\n[^k]: typed here\nNext line.");
    });

    it("a label a reference after it cites is fixed too", () => {
        expect(lint("Prose above.\n[^k]: typed here\nNext line.\n\nLater[^k] on.", On)).toBe("Prose above.\n\nLater[^k] on.\n\n[^k]: typed here\nNext line.");
    });
});
