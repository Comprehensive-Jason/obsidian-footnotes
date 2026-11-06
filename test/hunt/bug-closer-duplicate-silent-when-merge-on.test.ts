// Imported from the Kimi K3 cycle 4 hunt of 2026-09-16 (OpenCode worktree); 1 of 2 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { mergeDuplicateFootnoteDefinitions } from "../../src/linting/rules/merge-duplicate-definitions";

// A label after a %% block comment's closer on its line is a real
// definition that can never be CUT or MERGED (its line holds the comment's
// closer; the cycle-1/2 rulings pinned in bug-aftercloser-orphan-silent
// and bug-aftercloser-duplicate-silent). With `Merge duplicate
// definitions` ON, mergeDuplicateFootnoteDefinitions groups only
// findDefinitionBlocks' column-0 blocks, so the closer-line copy is never
// merged - and noticeDuplicateDefinitions then returns early BECAUSE the
// toggle is on. The duplicate is neither fixed nor reported.
//
// ADR-0002 (never silent): every problem lint won't fix by itself is
// surfaced, naming the footnotes. With the toggle OFF this exact shape is
// reported (the fixed pins); turning the toggle ON makes the report stop
// while the fix stays impossible, the worst of both worlds.
//
// What the user sees: nothing, ever. Obsidian renders only the LAST of
// the two definitions (the duplicate rule, verified live 2026-08-12), so
// one of their definitions is silently dead text, and no lint run tells
// them which footnote or why.
//
// Source of truth: docs/adr/0002-never-silent-lint.md ("duplicates are
// never passed over in silence") + the merge rule's own contract that a
// closer-line definition is never merged (so the alert is the only
// outlet).
//
// Settings involved: `Merge duplicate definitions` ON.

const doc = "use[^d] here\n\n%%\nhidden\n%% [^d]: after the closer\n\n[^d]: second";

describe("an unmergeable duplicate (one copy on a %% closer line) with the merge toggle ON", () => {
    beforeEach(resetNotices);

    it("control: the merge rule really cannot merge it (the line holds the closer)", () => {
        expect(mergeDuplicateFootnoteDefinitions(doc)).toBe(doc);
    });

    it("the duplicate alert still fires, because the fix cannot apply", () => {
        noticeLintAlerts(fakePlugin({ lintMergeDuplicateDefinitions: true }), doc);
        // the duplicate alert says what is wrong as well since 2026-11-05 (Jason)
        expect(messages()).toContain('This note defines "[^d]" more than once. Obsidian renders only the last definition. The lint left them as they are, because merging them would change how Obsidian reads the text around them. Merge them by hand.');
    });
});
