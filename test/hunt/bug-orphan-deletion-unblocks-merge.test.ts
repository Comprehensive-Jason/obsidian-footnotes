import { beforeEach, describe, expect, it } from "vitest";

import { lintFootnotes } from "../../src/linting/linter";
import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): with Merge duplicate definitions and Delete orphaned
// definitions both on, one lint deletes the orphan that blocked a merge
// but does not make the merge; the next lint does. And the alert after
// the first lint says nothing about the duplicate.
//
// What the user would see: [^a] has two top-level copies, and a third
// copy sits in a quote, held inside [^1]'s definition, which nothing
// references. The lint deletes [^1] (with the quoted [^a] copy in it).
// Nothing tells the user that [^a] is still defined twice. Linting again
// changes the note a second time: the two [^a] copies are merged.
//
// Hunt 2026-10-05, round 2, lens lint. Cluster L3.
//
// Source of truth: lint twice is lint once (the idempotence property in
// linter.ts's comments: "Caught by the idempotence property"); ADR 0002
// (docs/adr/0002-never-silent-lint.md): the lint is never silent about
// what it leaves.
//
// Cause: in lintFootnotes the merge runs before the orphan deletion. When
// the merge looks, [^a] has a copy in a quote, so the merge leaves all
// its copies alone. The orphan deletion then removes that quoted copy,
// and nothing merges again in the same lint. The duplicate alert stays
// quiet about a name the merge rule would now merge, taking it for one
// the rule will handle.
//
// Note: this note's first [^a] holds "[^2]: body2 inner" at its end, the
// shape of bug-merge-into-held-definition (the second lint appends
// "    body5 outer" into [^2]'s paragraph). Recheck this pin after that
// fix: the second lint should then merge cleanly, and the first lint
// should either do it too or name [^a] in the alert.
//
// Fixed with cluster L1 (hunt 2026-10-05 round 2): both top-level copies
// of [^a] hold a copy of [^2], which is defined twice, so the merge leaves
// [^a]'s copies as they are on every lint (movedDefinitions). The first
// lint's result is then settled, and the duplicate alert names [^a].

beforeEach(resetNotices);

const NOTE = [
    "[^a]: body1 outer",
    "",
    "    [^2]: body2 inner",
    "",
    "> [^1]: body3 outer",
    ">",
    ">     [^a]: body4 inner quoted",
    "",
    "[^a]: body5 outer",
    "",
    "    [^2]: body6 inner",
    "",
    "> alpha[^2] quoted text",
].join("\n");

const OPTIONS = {
    fixLazyDefinitions: false,
    moveDefinitionsToBottom: false,
    reindex: false,
    removeOrphanedDefinitions: true,
    mergeDuplicateDefinitions: true,
    sectionHeading: "",
};

describe("orphan deletion unblocks a merge the same lint does not make", () => {
    it("lint is idempotent", () => {
        const once = lintFootnotes(NOTE, OPTIONS);
        // Today: the second lint merges, turning "[^a]: body5 outer" into "    body5 outer".
        expect(lintFootnotes(once, OPTIONS)).toBe(once);
    });

    it("the duplicate alert names a after the lint", () => {
        const once = lintFootnotes(NOTE, OPTIONS);
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS, lintDeleteOrphanedDefinitions: true, lintMergeDuplicateDefinitions: true }), once);
        // Today: no alert names [^a].
        expect(messages().some((m) => m.includes('defines "[^a]" more than once') || m.includes('"[^a]", ') || m.includes(', "[^a]"'))).toBe(true);
    });
});
