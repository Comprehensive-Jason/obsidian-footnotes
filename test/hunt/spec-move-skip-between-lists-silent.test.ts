import { beforeEach, describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// spec question: when one definition sits between two lists, should Move
// definitions to bottom still gather the others, or at least say it left
// them where they are?
//
// What it does now: a definition between two lists makes move-to-bottom
// skip its WHOLE move (11198c4), since moving that one would join the
// lists. So [^1], which sits safely above the first list, is not
// gathered either, the "# Footnotes" heading is not added, and no alert
// says the definitions were left where they are. It stays this way on
// every lint.
// What a user might expect: the definitions that can move are gathered
// at the bottom and the one between the lists stays, or an alert names
// the definition that held the move back.
// Why it is a question and not a bug: skipping the whole move was a
// deliberate choice (11198c4, Jason's decision 2026-10-05: "move-to-
// bottom skips the whole move"), and the note is not damaged. Whether to
// move part of the definitions, or only to speak up, is Jason's call; ADR
// 0002 (docs/adr/0002-never-silent-lint.md) says the lint is never silent
// about what it leaves, which today it is here.
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L8.
//
// Source of truth: ADR 0002; 11198c4 (the list-joining guard).

beforeEach(resetNotices);

describe("move to bottom skipped because a definition sits between two lists", () => {
    it.fails("the definitions that can move are gathered, or an alert says they were not", () => {
        const note = ["Text[^1] and[^2].", "", "[^1]: one", "", "- item", "", "[^2]: two", "", "- item2"].join("\n");
        const out = lintFootnotes(note, { sectionHeading: "# Footnotes", fixPunctuation: false });
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), out);
        const gathered = out.trimEnd().endsWith("[^1]: one");
        const told = messages().some((m) => m.includes('"[^2]'));
        // Today: neither; the note is unchanged and no alert names [^2].
        expect(gathered || told).toBe(true);
    });
});
