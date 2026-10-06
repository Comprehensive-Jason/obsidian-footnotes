import { beforeEach, describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// Settled behaviour: when one definition sits between two lists, Move
// definitions to bottom still skips its whole move (moving that one would
// join the lists, 11198c4), and the lint alert now says so, naming the
// definition that held the move back with the general "left in place"
// reason.
//
// The note is "Text[^1] and[^2].", "[^1]: one", "- item", "[^2]: two",
// "- item2" (blank lines between). The lint leaves it unchanged, and the
// alert reads: This note has a footnote definition the lint could not move
// to the bottom ("[^2]"), and the lint left it in place, because moving it
// would change how Obsidian reads the lines around it. Move it by hand,
// and the next lint gathers the rest.
//
// This started as an open spec question from the hunt (2026-10-05, round
// 2, lens lint, cluster L8): the move was skipped and nothing said so, on
// every lint. Jason's triage decision Q5 (2026-10-05) settled it: say so
// with the existing general "left in place" alert, no new text.
//
// Source of truth: Jason's triage decision Q5, 2026-10-05; ADR 0002
// (docs/adr/0002-never-silent-lint.md): the lint is never silent about
// what it leaves; 11198c4 (the list-joining guard).

beforeEach(resetNotices);

const NOTE = ["Text[^1] and[^2].", "", "[^1]: one", "", "- item", "", "[^2]: two", "", "- item2"].join("\n");

describe("move to bottom skipped because a definition sits between two lists", () => {
    it("the note is left as it is, and the alert names the definition that held the move back", () => {
        const out = lintFootnotes(NOTE, { sectionHeading: "# Footnotes", fixPunctuation: false });
        expect(out).toBe(NOTE);
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), out);
        expect(messages()).toContain(
            'This note has a footnote definition the lint could not move to the bottom ("[^2]"), and the lint left it in place, because moving it would change how Obsidian reads the lines around it. Move it by hand, and the next lint gathers the rest.',
        );
    });

    it("no move alert while Move footnotes to the bottom is off", () => {
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS, lintMoveToBottom: false }), NOTE);
        expect(messages().some((m) => m.includes("could not move"))).toBe(false);
    });

    it("control: once the definition is moved by hand, the lint gathers the rest and the alert is quiet", () => {
        const byHand = ["Text[^1] and[^2].", "", "[^1]: one", "", "- item", "- item2", "", "[^2]: two"].join("\n");
        const out = lintFootnotes(byHand, { sectionHeading: "", fixPunctuation: false });
        expect(out).toBe(["Text[^1] and[^2].", "", "- item", "- item2", "", "[^1]: one", "[^2]: two"].join("\n"));
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), out);
        expect(messages().some((m) => m.includes("could not move"))).toBe(false);
    });
});
