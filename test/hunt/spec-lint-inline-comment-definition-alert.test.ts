import { describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// spec question: should a definition written inside a one-line %% comment
// get the "inside a %% comment" alert?
//
// What it does now: the note has "use[^98] here" and the line "%% [^98]:
// inline comment label %%". Obsidian hides the whole line, so [^98] has no
// definition. The only alert is the orphan one ("Write its definition or
// delete the reference"), which tells the user to write a definition they
// already wrote.
// What a user might expect: the alert a definition inside a %% block
// comment gets: "This note has a footnote definition inside a %% comment
// ... Move it out of the comment."
// Why it is a question and not a bug: ruling A1 (2026-09-15) and its alert
// were about %% block comments, the lines between a "%%" line and the
// next. A label inside a %% pair on one line is dead text
// (bug-lazy-label-in-inline-comment), and whether the alert should reach
// that shape too is Jason's call.
//
// Hunt 2026-10-02, round 4, lens alerts. Cluster A10.
//
// Source of truth: ruling A1 and the commented-definition alert in
// lint-alerts.ts; ADR 0002 (the lint is never silent about what it cannot
// fix, and its advice should fit the case).

describe("spec question: a definition inside a one-line %% comment", () => {
    it.fails("is named by the commented-definition alert", () => {
        const doc = "use[^98] here\n\n%% [^98]: inline comment label %%\n";
        const plugin = fakePlugin({ ...DEFAULT_SETTINGS, lintMoveToBottom: false, lintReindex: false });
        const after = lintFootnotes(doc, lintOptionsFromSettings(plugin, "", doc));
        resetNotices();
        noticeLintAlerts(plugin, after);
        // Today: only the orphan alert.
        expect(messages().some((m) => m.includes("inside a %% comment"))).toBe(true);
    });
});
