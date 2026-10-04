// Imported from the GLM 5.3 Flash cycle 1 hunt of 2026-09-16 (OpenCode worktree); 3 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import {
    duplicateFootnoteDefinitionNames,
    mergeDuplicateFootnoteDefinitions,
} from "../../src/linting/rules/merge-duplicate-definitions";

// Scenario: the SAME footnote name defined TWICE - once in a definition
// whose label follows a "%%" block comment's closer on its line
// ("%% [^d]: first body" - a real definition, Jason's verification
// 2026-09-15, sheet 11), and once in an ordinary column-0 definition.
//
// What the user sees: Obsidian renders only the LAST definition of a name
// (ground truth recorded in merge-duplicate-definitions.ts: "Every earlier
// one is dead text that disappears without a word"), so the note's "first
// body" silently disappears from Reading view. The user opted into the
// never-silent posture (ADR 0002: every problem the lint won't fix is
// surfaced as an alert, never passed over in silence), so lint should name
// the duplicate - exactly as it names an ORPHAN whose label sits on a
// closer line, which scanReferences deliberately reports as a block
// ("an orphan the rule will not delete is named, never passed over in
// silence (ADR 2)").
//
// What the plugin does: both the duplicate alert and the merge rule read
// only findDefinitionBlocks, and a closer-line label never forms one (its
// line starts with "%%", so DefinitionStart does not match and the line can
// never be cut). The orphan alerts see closer-line labels because they push
// quoted labels themselves; the duplicate alert does not. Result: with
// Merge OFF the lint is completely silent about the pair (checked via the
// notice recorder), and with Merge ON the note comes back byte for byte
// unchanged - the first body disappears in Reading view either way, and no
// lint ever says why.
//
// Source of truth: ADR 0002 ("every content-destroying fix is surfaced as a
// lint alert instead... duplicate definitions alert rather than merge") +
// the recorded ground truth that a closer-line label defines its footnote
// (bug-aftercloser-orphan-silent's own header) + the duplicate
// check of the manual lint-alerts tests ("an alert says [^dup] is defined more than once"). The
// documented carve-out for BLOCKQUOTED duplicates (C22: merging would need
// quote-marker-aware continuations) does not cover the closer line, which
// the orphan alert already treats as alertable. Settings involved:
// `Merge duplicate definitions` OFF (its default) for the alert; ON for the
// merge check.

const DUP_DOC = "text[^d] here\n\n%%\nhidden\n%% [^d]: first body\n\n[^d]: second body";

describe("a duplicate whose one definition follows a %% closer is never reported", () => {
    beforeEach(resetNotices);

    it("the duplicate alert names the footnote defined twice (once after a closer)", () => {
        expect(duplicateFootnoteDefinitionNames(DUP_DOC)).toEqual(["d"]);
    });

    it("the never-silent policy: the lint alerts about the duplicate while merging is off", () => {
        noticeLintAlerts(fakePlugin({}), DUP_DOC);
        expect(messages().some((m) => m.includes("more than once") || m.includes("defined"))).toBe(true);
    });

    it("with merging ON the closer-line copy is left alone: reported, never merged", () => {
        // the merge cannot cut a line that holds the comment's closer, so
        // this duplicate stays where it is, the way a quoted duplicate does
        // (the C22 carve-out); the alert above is what tells the user
        // (rewritten to the fix, 2026-09-16)
        expect(mergeDuplicateFootnoteDefinitions(DUP_DOC)).toBe(DUP_DOC);
    });

    it("control: two column-0 duplicates are named by the alert", () => {
        expect(duplicateFootnoteDefinitionNames("x[^d]\n\n[^d]: one\n[^d]: two")).toEqual(["d"]);
    });
});
