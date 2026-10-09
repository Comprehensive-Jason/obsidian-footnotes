// spec question Q35 (cluster V12): the lint's punctuation rule leaves a
// space before the full stop when the user typed a space before the
// reference. What should it do?
//
// What it does now: with the default settings (After), "Oysters filter
// water [^1]." lints to "Oysters filter water .[^1]", and "A claim [^1],
// and more." to "A claim ,[^1] and more." (live: "water .[1]"). It has done
// this since the rule's first port (6ca151e).
// Options: (a) attach the reference: "water.[^1]" (live: "water.[1]");
// (b) leave a spaced reference where it is: "water [^1]."; (c) keep the
// space before the reference: "water. [^1]". To rule together with D10
// (spec-delete-stray-space-before-punctuation) and G9 (the French space).
// This file asserted no space is left in front of the punctuation.
//
// Answered (Jason's ruling Q35, 2026-10-09), option (a): the rule attaches
// a reference typed with a space before it. "Oysters filter water [^1]."
// becomes "Oysters filter water.[^1]" under After, and under Before the
// reference keeps no stray space either: "water [^1]." becomes
// "water[^1].". The same answer settles D10 (Delete footnote everywhere
// leaving "word .", spec-delete-stray-space-before-punctuation) and G9
// (the French space, spec-lint-french-space-before-punctuation): the
// spaces typed between a word and its reference belong to the reference,
// and a space in front of the punctuation stays with the punctuation. The
// tests below were it.fails until then and now assert the decided result
// exactly; what the rule did before is described above.
//
// Hunt 2026-10-09, cycle 8, lenses the lint and the gate (found by both).
// Source: Jason's attach ruling of 2026-09-08 (aa25d9e), which covers the
// space the plugin writes, not one the user typed.
// Origin: pre-existing (red at 34d5377 and 3a47f7a).

import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { lintFootnotes, LintOptions, lintNote } from "../../src/linting/linter";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS, FootnotePluginSettings } from "../../src/settings";

beforeEach(resetNotices);

// probe: the default lint (Fix footnote reference placement on,
// placement After) on a reference typed with a space in front of it,
// "a claim [^1]." It moves the reference after the full stop and leaves
// the space where it was, in front of the full stop: "a claim .[^1]". The
// result gate passes it, since it compares the words of a line with its
// references taken out, and "a claim [^1]." already reads "a claim ." that
// way.
const defaults: LintOptions = {
    sectionHeading: "",
    fixPunctuation: true,
    placement: "after",
    fixLazyDefinitions: true,
    moveDefinitionsToBottom: true,
    reindex: true,
    reindexOptions: { renumberNamedFootnotes: false, nameNumberedFootnotes: false },
    removeOrphanedReferences: false,
    removeOrphanedDefinitions: false,
    mergeDuplicateDefinitions: false,
    orphanSafePrefix: "",
    applyNotePrefix: false,
    removeEmptySectionHeading: false,
};
const first = (note: string) => lintFootnotes(note, defaults).split("\n")[0];

describe("the punctuation rule and a space typed before a reference, under After", () => {
    it("control: a reference glued to its word moves after the full stop", () => {
        expect(first("This is a claim[^1].\n\n[^1]: Smith.")).toBe("This is a claim.[^1]");
    });
    it("ruling Q35: a reference with a space before it attaches to its word, after the full stop", () => {
        expect(first("Oysters filter water [^1].\n\n[^1]: Smith.")).toBe("Oysters filter water.[^1]");
    });
    it("and after a comma", () => {
        expect(first("A claim [^1], and more.\n\n[^1]: Smith.")).toBe("A claim,[^1] and more.");
    });
    it("and after the full stop of a sentence that goes on", () => {
        expect(first("This is a claim [^1]. Next one.\n\n[^1]: Smith.")).toBe("This is a claim.[^1] Next one.");
    });
    it("a tab and two spaces go too, and an inline footnote attaches the same way", () => {
        expect(first("Two  [^1] and a tab\t[^2].\n\n[^1]: A.\n[^2]: B.")).toBe("Two  [^1] and a tab.[^2]");
        expect(first("Water ^[an inline note].")).toBe("Water.^[an inline note]");
    });
    it("in a list item, a quote, and a table cell", () => {
        expect(first("- Oysters filter water [^1].\n\n[^1]: Smith.")).toBe("- Oysters filter water.[^1]");
        expect(first("> Oysters filter water [^1].\n\n[^1]: Smith.")).toBe("> Oysters filter water.[^1]");
        expect(first("| Oysters filter water [^1]. | b |\n| --- | --- |\n\n[^1]: Smith.")).toBe("| Oysters filter water.[^1] | b |");
    });
    it("in front of an email address's full stop, the reference attaches where ruling Q30 puts it", () => {
        const note = "Write to me@example.com [^1].\n\n[^1]: Smith.";
        expect(first(note)).toBe("Write to me@example.com[^1].");
        expect(lintFootnotes(lintFootnotes(note, defaults), defaults)).toBe(lintFootnotes(note, defaults));
    });
    it("control: a spaced reference with no punctuation after it stays where it is", () => {
        expect(first("Oysters filter water [^1] every day.\n\n[^1]: Smith.")).toBe("Oysters filter water [^1] every day.");
    });
    it("control: a reference alone after a list marker or a table's pipe keeps the space", () => {
        expect(first("- [^1].\n\n[^1]: Smith.")).toBe("- .[^1]");
        expect(first("| [^1]. | b |\n| --- | --- |\n\n[^1]: Smith.")).toBe("| .[^1] | b |");
    });
    it("a second lint changes nothing", () => {
        const note = "Oysters filter water [^1]. A claim [^2], and more.\n\n[^1]: Smith.\n\n[^2]: Jones.";
        const once = lintFootnotes(note, defaults);
        expect(lintFootnotes(once, defaults)).toBe(once);
    });
});

/** Lints `text` as the plugin does with the default settings plus `settings`, shows the alerts, and returns both. */
function alertsAfterLint(text: string, settings: Partial<FootnotePluginSettings> = {}) {
    const plugin = fakePlugin({ ...DEFAULT_SETTINGS, ...settings });
    const linted = lintNote(plugin, text, "");
    resetNotices();
    noticeLintAlerts(plugin, linted);
    return { linted, alerts: messages() };
}

// A bare web address glued to the reference would take the reference in,
// so the space typed between them keeps the reference out of the link, and
// the reference stays where it was typed, with nothing said (as
// bug-lint-alerts-on-email-period-reference leaves Q30's landing alone).
describe("a spaced reference after a bare web address", () => {
    for (const placement of ["after", "before"] as const) {
        it(`under ${placement}, stays where it was typed, and nothing is said`, () => {
            const note = "See https://example.org [^1].\n\n[^1]: Smith.";
            const { linted, alerts } = alertsAfterLint(note, { footnotePlacement: placement });
            expect(linted).toBe(note);
            expect(alerts).toEqual([]);
        });
    }
});

describe("the punctuation rule and a space typed before a reference, under Before", () => {
    const before = (note: string) => lintFootnotes(note, { ...defaults, placement: "before" }).split("\n")[0];
    it("ruling Q35: a reference with a space before it, in front of the full stop, attaches to its word", () => {
        expect(before("Oysters filter water [^1].\n\n[^1]: Smith.")).toBe("Oysters filter water[^1].");
    });
    it("a reference after a full stop with a space in front of it moves back onto the word, the space staying with the full stop", () => {
        expect(before("Oysters filter water .[^1]\n\n[^1]: Smith.")).toBe("Oysters filter water[^1] .");
    });
    it("control: a reference glued to its word stays in front of the full stop", () => {
        expect(before("Oysters filter water[^1].\n\n[^1]: Smith.")).toBe("Oysters filter water[^1].");
    });
});
