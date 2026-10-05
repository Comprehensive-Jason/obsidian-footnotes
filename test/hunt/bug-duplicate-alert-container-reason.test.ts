import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (annoyance): with Merge duplicate definitions on, the alert about a
// footnote defined twice, once in a list item or a quote and once at the
// top level, gives a reason that is not true.
//
// What the user would see: their note defines [^a] in a list item
// ("- [^a]: in the item") and again at the top level ("[^a]: at the
// top"). The lint leaves both, and the alert says it could not merge
// them because "a copy sits on the line of a "%%" comment's closer, or
// holds a table". Neither is so: one copy sits in a list item (or a
// quote), which the merge leaves alone on purpose.
//
// Hunt 2026-10-05, round 1, lens containers. Cluster CN5.
//
// Source of truth: merge-duplicate-definitions.ts (only a name whose
// every copy can be moved is merged), ruling 1, option a, 2026-10-03 (a
// definition in a list item or quote is never moved out of it); the
// promise that an alert names the reason the lint left something in
// place.
//
// Cause: the duplicate alert in lint-alerts.ts gives one reason for
// every name the merge refused: the one for a copy on a "%%" closer's
// line or a copy holding a table. A refusal because a copy sits in a
// list item or a quote has no reason of its own.
//
// Decided (Jason, 2026-10-05, Q6 option 1): one general reason that names
// no cause, so a new case never makes the text wrong: "...more than once,
// and the lint left them as they are, because merging them would change
// how Obsidian reads the lines around them. Obsidian renders only the last
// definition. Merge them by hand."

const Expected =
    'This note defines "[^a]" more than once, and the lint left them as they are, because merging them would change how Obsidian reads the lines around them. Obsidian renders only the last definition. Merge them by hand.';

beforeEach(resetNotices);

const mergeOn = { ...DEFAULT_SETTINGS, lintMergeDuplicateDefinitions: true };

describe("the merge-on duplicate alert for an in-container copy", () => {
    it("an in-item copy and a top-level copy: the alert's reason fits (no %% closer, no table)", () => {
        const note = ["a[^a] b", "", "- [^a]: in the item", "", "[^a]: at the top"];
        noticeLintAlerts(fakePlugin(mergeOn), note.join("\n"));
        const dup = messages().find((m) => m.includes("more than once"));
        expect(dup).toBeDefined();
        // Today: the reason names a comment's closer or a table.
        expect(dup).not.toMatch(/comment's closer|holds a table/);
        expect(dup).toBe(Expected);
    });

    it("a quoted copy and a top-level copy: the alert's reason fits", () => {
        const note = ["a[^a] b", "", "> [^a]: in the quote", "", "[^a]: at the top"];
        noticeLintAlerts(fakePlugin(mergeOn), note.join("\n"));
        const dup = messages().find((m) => m.includes("more than once"));
        expect(dup).toBeDefined();
        expect(dup).not.toMatch(/comment's closer|holds a table/);
        expect(dup).toBe(Expected);
    });
});
