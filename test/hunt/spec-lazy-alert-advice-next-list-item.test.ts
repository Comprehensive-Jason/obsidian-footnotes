import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintNote } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// A lazy label between two items of a list: "1. item[^1]", "[^1]: def", "2. next".
// Fix definitions hidden by a missing blank line refuses this blank line, because
// "2. next" and every item after it would become the footnote's text.
//
// What the user saw: "Put a blank line above it.", the very blank line the rule
// refused. Following it put the next items inside the footnote.
//
// Hunt 2026-11-06, cycle 9, finding H16. Severity: annoyance. Origin: pre-existing.
//
// Source of truth: the triage of cycle 9 (the advice must not swallow the next list
// items); the comment in fix-lazy-definitions.ts (live Obsidian 1.14.4, 2026-10-05;
// Jason's triage decision Q7), and his ruling Q9 (2026-10-07), which gave the
// underlined label the same wording.

const AboveAndBelow = (label: string) => `Obsidian reads "${label}:" as plain text, not as a footnote definition. Put a blank line above it and another below it.`;

/** The alerts after a lint of `note`. */
function alerts(note: string, settings = DEFAULT_SETTINGS): string[] {
    const plugin = fakePlugin(settings);
    const after = lintNote(plugin, note, "");
    resetNotices();
    noticeLintAlerts(plugin, after);
    return messages();
}

beforeEach(resetNotices);

describe("the lazy label alert on a label between list items", () => {
    it("a numbered list: the advice asks for a blank line above and below, which keeps the next items out of the footnote", () => {
        expect(alerts("1. item[^1]\n[^1]: def\n2. next\n3. after")).toEqual([AboveAndBelow("[^1]")]);
        const followed = readNote("1. item[^1]\n\n[^1]: def\n\n2. next\n3. after".split("\n"));
        expect(followed.definitions.map(({ start, end }) => [start, end])).toEqual([[2, 2]]);
    });

    it("a bulleted list gets the same advice", () => {
        expect(alerts("- item[^1]\n[^1]: def\n- next")).toEqual([AboveAndBelow("[^1]")]);
    });

    it("several labels get the plural", () => {
        expect(alerts("1. a[^1]\n[^1]: one\n2. b[^2]\n[^2]: two\n3. c")).toEqual([
            'Obsidian reads "[^1]:" and "[^2]:" as plain text, not as footnote definitions. Put a blank line above and below each.',
        ]);
    });

    it("control: a list that starts under the label is not swallowed, so the alert keeps its short advice", () => {
        const off = { ...DEFAULT_SETTINGS, lintFixLazyDefinitions: false };
        expect(alerts("Prose[^1]\n[^1]: def\n- next", off)).toEqual(['Obsidian reads "[^1]:" as plain text, not as a footnote definition. Put a blank line above it.']);
        const followed = readNote("Prose[^1]\n\n[^1]: def\n- next".split("\n"));
        expect(followed.definitions.map(({ start, end }) => [start, end])).toEqual([[2, 2]]);
    });

    it("control: prose under the label keeps the short advice, since the label's paragraph is its text by ruling", () => {
        const off = { ...DEFAULT_SETTINGS, lintFixLazyDefinitions: false };
        expect(alerts("Prose[^1]\n[^1]: def\nmore", off)).toEqual(['Obsidian reads "[^1]:" as plain text, not as a footnote definition. Put a blank line above it.']);
    });
});
