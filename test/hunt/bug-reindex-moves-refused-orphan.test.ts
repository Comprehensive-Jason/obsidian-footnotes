import { beforeEach, describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): an orphan that Delete orphaned definitions refused to
// cut is moved by Reindex to a place where the NEXT lint cuts it, and the
// alert after the first lint does not mention it.
//
// What the user would see: an unreferenced "[^b]: orphan" sits between
// two lists. The lint keeps it (cutting it would join the lists) and
// moves it to the end of the note, below "- two", without a word about
// it. Linting again deletes it.
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L4.
//
// Source of truth: lint twice is lint once (the idempotence property in
// linter.ts's comments); ADR 0002 (docs/adr/0002-never-silent-lint.md):
// the lint is never silent about what it leaves.
//
// Cause: the orphan rule refuses the cut (it would join the two lists,
// 11198c4), and move-to-bottom skips its whole move for the same reason.
// Reindex runs after them and swaps the orphan into the slot of a later
// definition ("[^1]: used"), at the end of the note, where nothing stops
// the next lint's orphan rule. After the first lint, the orphan alert
// stays quiet about [^b], taking it for an orphan a single-rule command
// left, though the orphan rule would now delete it.
//
// Fix (Jason's decision, 2026-10-05): while Delete orphaned definitions is
// on, reindex leaves an orphan in its own slot (its leaveOrphansInPlace
// option), so the orphan stays between the lists, lint after lint.

beforeEach(resetNotices);

const NOTE = ["Text[^1].", "", "- one", "", "[^b]: orphan", "", "- two", "", "[^1]: used"].join("\n");
const OPTIONS = { sectionHeading: "# Footnotes", removeOrphanedDefinitions: true };

describe("reindex moves an orphan the orphan rule refused", () => {
    it("lint is idempotent", () => {
        const once = lintFootnotes(NOTE, OPTIONS);
        // Before the fix, once ="Text.[^1]\n\n- one\n\n[^1]: used\n\n- two\n\n[^b]: orphan", and lint 2 deleted "[^b]: orphan".
        expect(lintFootnotes(once, OPTIONS)).toBe(once);
    });

    it("after the first lint, the orphan alert names [^b]", () => {
        const once = lintFootnotes(NOTE, OPTIONS);
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS, lintDeleteOrphanedDefinitions: true }), once);
        // Before the fix, no alert named [^b].
        expect(messages().some((m) => m.includes('"[^b]"'))).toBe(true);
    });
});
