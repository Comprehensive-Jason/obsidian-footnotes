import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// A lazy label indented into its own list item, with the next item right under it:
// "- item[^1]", "  [^1]: def", "- next".
//
// What the user sees, with Fix definitions off: the alert asked for a blank line
// above and another below, though the blank line above is enough, since the next
// item already ends the footnote. Following it added a blank line between the items
// that the note did not need. The long advice is for a label at the list's own
// margin, whose blank line above would take the next items into the footnote.
//
// Hunt 2026-11-06, cycle 10, the lint hunter's finding 7. Source of truth: the
// purpose stated in ba1c261, and the premise test below on Fix definitions' own
// result; no live answer yet (the finding asks whether footnote 1 shows "def" with
// "next" as a second item outside it). Severity: annoyance. Origin: regression from
// ba1c261.

const Off = { ...DEFAULT_SETTINGS, lintFixLazyDefinitions: false };
const Short = 'Obsidian reads "[^1]:" as plain text, not as a footnote definition. Put a blank line above it.';
const Long = 'Obsidian reads "[^1]:" as plain text, not as a footnote definition. Put a blank line above it and another below it.';

beforeEach(resetNotices);

describe("the lazy alert on a label indented into its own list item", () => {
    it.each([
        ["bullets", "- item[^1]\n  [^1]: def\n- next"],
        ["numbers", "1. item[^1]\n   [^1]: def\n2. next"],
        ["a nested item", "- top\n  - item[^1]\n    [^1]: def\n  - next"],
    ])("%s keep the short advice", (_label, note) => {
        noticeLintAlerts(fakePlugin(Off), note);
        expect(messages()).toEqual([Short]);
    });

    it("premise: the blank line above alone ends the footnote at its label, and the next item stays out", () => {
        const note = "- item[^1]\n  [^1]: def\n- next";
        const fixed = lintFootnotes(note, lintOptionsFromSettings(fakePlugin({ ...DEFAULT_SETTINGS }), "", note));
        expect(fixed).toBe("- item[^1]\n\n  [^1]: def\n- next");
        const [definition] = readNote(fixed.split("\n")).definitions;
        expect(definition.end).toBe(definition.start);
    });
});

describe("controls: a label at the list's own margin keeps the long advice", () => {
    it.each([
        ["bullets", "- item[^1]\n[^1]: def\n- next"],
        ["numbers", "1. item[^1]\n[^1]: def\n2. next"],
        ["numbers in a quote", "> 1. item[^1]\n> [^1]: def\n> 2. next"],
    ])("%s", (_label, note) => {
        noticeLintAlerts(fakePlugin(Off), note);
        expect(messages()).toEqual([Long]);
    });
});
