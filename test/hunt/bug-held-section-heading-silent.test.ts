// Found by the subtraction pass's lint job (sub-lint, 2026-10-08, "needs
// Jason's eyes" 3) and ruled a bug by Jason on 2026-10-09 (ruling 2; ADR
// 0002, the lint is never silent). Origin: 1d67ac6, which took out the
// blank line the move put at the top of the phantom-frontmatter note and
// left the result gate to refuse the move.
//
// With the Section heading setting on and set to "---" / "## Footnotes",
// the note "---" / "" / "alpha[^1]. alpha" / "" / "[^Note]: alpha" gets
// nothing from the lint, which is right: the heading's "---" would close
// the "---" at the top into frontmatter and hide the top of the note. But
// the lint said nothing about the heading it left out. The definition
// already ends the note, so the move alert, which names the definitions
// the move left where they were, had nothing to name.
//
// The rule (Jason, ruling 2): whenever the result gate holds back the move
// to the bottom, the move alert names what was held, and the section
// heading too when the heading is what cannot be added, whatever makes it
// so. The second shape here is a heading that is a link reference
// definition, which would turn "[link]" in the text into a link.
import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { lintNote } from "../../src/linting/linter";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import type { FootnotePluginSettings } from "../../src/settings";

const HeadingHeld = "The lint could not add the footnote section heading, because it would change how Obsidian reads the text around it.";

/** Lints `text` with the move on and the Section heading setting set to `heading`, shows the alerts for the result, and returns both. */
function alertsAfterLint(text: string, heading: string, settings: Partial<FootnotePluginSettings> = {}) {
    const plugin = fakePlugin({
        lintFixPunctuation: false,
        lintFixLazyDefinitions: false,
        lintReindex: false,
        lintMoveToBottom: true,
        enableFootnoteSectionHeading: true,
        footnoteSectionHeading: heading,
        ...settings,
    });
    const linted = lintNote(plugin, text, plugin.settings.lintMoveToBottom ? heading : "");
    resetNotices();
    noticeLintAlerts(plugin, linted);
    return { linted, alerts: messages() };
}

beforeEach(resetNotices);

describe("the move alert names a section heading the lint could not add", () => {
    it("the phantom-frontmatter note: nothing added, and the heading named", () => {
        const doc = "---\n\nalpha[^1]. alpha\n\n[^Note]: alpha";
        const { linted, alerts } = alertsAfterLint(doc, "---\n## Footnotes");
        expect(linted).toBe(doc);
        expect(alerts).toContain(HeadingHeld);
    });

    it("the phantom-frontmatter note with the definition in the middle: the heading and the definition named", () => {
        const doc = "---\n\n[^Note]: alpha\n\nalpha[^1]. alpha";
        const { linted, alerts } = alertsAfterLint(doc, "---\n## Footnotes");
        expect(linted).toBe(doc);
        expect(alerts).toContain(HeadingHeld);
        expect(alerts.some((alert) => alert.includes("could not move to the bottom") && alert.includes('"[^Note]"'))).toBe(true);
    });

    it("a heading that would turn text into a link: nothing added, and the heading named", () => {
        const doc = "See [link] here[^1].\n\n[^1]: one";
        const { linted, alerts } = alertsAfterLint(doc, "[link]: https://example.com");
        expect(linted).toBe(doc);
        expect(alerts).toContain(HeadingHeld);
    });

    it("control: a heading the lint can add is added, and nothing is said about it", () => {
        const { linted, alerts } = alertsAfterLint("See here[^1].\n\n[^1]: one", "## Footnotes");
        expect(linted).toBe("See here[^1].\n\n## Footnotes\n\n[^1]: one");
        expect(alerts).not.toContain(HeadingHeld);
    });

    it("control: a definition held between two lists is named, and the heading is not", () => {
        const doc = "- a[^1]\n\n[^1]: one\n- b";
        const { linted, alerts } = alertsAfterLint(doc, "## Footnotes");
        expect(linted).toBe(doc);
        expect(alerts).not.toContain(HeadingHeld);
        expect(alerts.some((alert) => alert.includes("could not move to the bottom") && alert.includes('"[^1]"'))).toBe(true);
    });

    it("control: with the move off, nothing is said about the heading", () => {
        const doc = "---\n\nalpha[^1]. alpha\n\n[^Note]: alpha";
        const { alerts } = alertsAfterLint(doc, "---\n## Footnotes", { lintMoveToBottom: false });
        expect(alerts).not.toContain(HeadingHeld);
    });
});
