import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";
import { lintNote } from "../src/linting/linter";
import { noticeLintAlerts } from "../src/linting/lint-alerts";
import type { FootnotePluginSettings } from "../src/settings";

// The lint is never silent (ADR 0002). Since the result gate decides for
// the lint (ADR 0003), three rules can hold a change back: the punctuation
// rule a move, apply prefix a rename, and reindex a rename (renumbering, or
// naming after the footnote's text) or the order of its definitions. Each now names what it held, in the lint's
// alert style, with the general "would change how Obsidian reads the lines
// around it" reason (stage 5 of the result gate design, 2026-10-08).
// Before, all three held back without a word.

const rules: Partial<FootnotePluginSettings> = { lintFixPunctuation: true, lintReindex: true, lintMoveToBottom: true, lintFixLazyDefinitions: true };

/** Lints `text` as the plugin does (lintNote), then shows the alerts for the result, and returns the alerts. */
function alertsAfterLint(text: string, settings: Partial<FootnotePluginSettings>) {
    const plugin = fakePlugin({ ...rules, ...settings });
    const linted = lintNote(plugin, text, "");
    resetNotices();
    noticeLintAlerts(plugin, linted);
    return { linted, alerts: messages() };
}

beforeEach(resetNotices);

describe("the punctuation rule names a reference it could not move", () => {
    it("After: a move past a '!' that would make an image", () => {
        const { linted, alerts } = alertsAfterLint("It was free[^1]!(sic) here.\n\n[^1]: one", { footnotePlacement: "after" });
        expect(linted).toBe("It was free[^1]!(sic) here.\n\n[^1]: one");
        expect(alerts).toEqual([
            'This note has a footnote reference the lint could not move to the other side of its punctuation ("[^1]"), and the lint left it in place, because moving it would change how Obsidian reads the lines around it.',
        ]);
    });

    it("Before: a move that would make an inline footnote out of the reference", () => {
        const { alerts } = alertsAfterLint("mc^.[^1] x\n\n[^1]: one", { footnotePlacement: "before" });
        expect(alerts).toEqual([
            'This note has a footnote reference the lint could not move to the other side of its punctuation ("[^1]"), and the lint left it in place, because moving it would change how Obsidian reads the lines around it.',
        ]);
    });

    it("two of them in one alert", () => {
        const { alerts } = alertsAfterLint("It was free[^1]!(sic) and free[^2]!(sic) here.\n\n[^1]: one\n[^2]: two", { footnotePlacement: "after" });
        expect(alerts).toEqual([
            'This note has 2 footnote references the lint could not move to the other side of their punctuation ("[^1]", "[^2]"), and the lint left them in place, because moving them would change how Obsidian reads the lines around them.',
        ]);
    });

    it("nothing is said with the rule off", () => {
        const { alerts } = alertsAfterLint("It was free[^1]!(sic) here.\n\n[^1]: one", { footnotePlacement: "after", lintFixPunctuation: false });
        expect(alerts).toEqual([]);
    });

    it("nothing is said for a note the lint settles", () => {
        const { alerts } = alertsAfterLint("It was free[^1]. Here.\n\n[^1]: one", { footnotePlacement: "after" });
        expect(alerts).toEqual([]);
    });
});

describe("apply prefix names a footnote it could not rename", () => {
    it("a '$' in the prefix that would pair with a dollar amount", () => {
        const text = "---\nfootnote-prefix: a$\n---\nCost $5 [^note] here\n\n[^note]: n";
        const { linted, alerts } = alertsAfterLint(text, { enableFootnotePrefix: true, lintApplyPrefix: true });
        expect(linted).toBe(text);
        expect(alerts).toEqual([
            'This note has a footnote the lint could not give the note\'s prefix ("[^note]"), and the lint left it as it is, because renaming it would change how Obsidian reads the lines around it.',
        ]);
    });
});

describe("reindex names a footnote it could not rename", () => {
    it("named after its text under a '$' prefix, it would pair with a dollar amount", () => {
        const text = "---\nfootnote-prefix: a$\n---\nCost $5 [^a$1] here\n\n[^a$1]: apple pie";
        const { linted, alerts } = alertsAfterLint(text, { footnoteNaming: "named", enableFootnotePrefix: true, lintApplyPrefix: true });
        // "[^a$apple]" after "$5" reads as math, "$5 [^a$"
        expect(linted).toBe(text);
        expect(alerts).toEqual([
            'This note has a footnote the lint could not rename ("[^a$1]"), and the lint left it as it is, because renaming it would change how Obsidian reads the lines around it.',
        ]);
    });
});

describe("reindex names the definitions it could not put in order", () => {
    it("a '$$' that ends the note, which would open a math block in an earlier slot", () => {
        const text = "Text[^1] and.[^2]\n\n[^2]: two\n[^1]: one\n$$";
        const { linted, alerts } = alertsAfterLint(text, {});
        expect(linted).toBe(text);
        expect(alerts).toEqual([
            'This note has 2 footnote definitions the lint could not put in order ("[^2]", "[^1]"), and the lint left them in place, because moving them would change how Obsidian reads the lines around them.',
        ]);
    });
});
