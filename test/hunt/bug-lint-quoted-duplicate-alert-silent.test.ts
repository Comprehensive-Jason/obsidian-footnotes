import { beforeEach, describe, expect, it } from "vitest";

import { noticeLintAlerts } from "../../src/linting/lint-alerts";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (silent): a footnote defined once inside a blockquote or callout and
// again at the left margin gets no duplicate alert.
//
// What the user would see: the note holds "> [^a]: one" and, further down,
// "[^a]: two". Obsidian shows only one of them, so one definition is lost
// from view. With Merge duplicate definitions off (the default), the lint
// promises to tell the user about duplicates instead of merging them. It
// says nothing.
//
// Hunt 2026-10-02, round 4, lens promise. Cluster PR3 (the alert half).
// The merge half is not pinned: merging into or out of a quoted block is
// carved out on purpose (C22, merge-duplicate-definitions.ts), but the
// alert is the never-silent fallback for exactly what the plugin will not
// fix itself.
//
// Source of truth: the Merge duplicate definitions description ("While
// off, linting alerts you about duplicates instead"); the README ("the
// plugin can alert you or merge them into one"); ADR 0002 (the lint is
// never silent about what it cannot fix). Convert, navigation, and copy
// and paste already treat this pair as duplicates.
//
// Needs a Reading-view check: "a[^a] b", a blank line, "> [^a]: one", a
// blank line, "[^a]: two". Confirm Obsidian renders one footnote a (and
// which body), not two. If it renders both, this pin is deleted.
//
// Severity: low. Nothing is changed; one definition is hidden without a
// word.
//
// Cause: duplicateFootnoteDefinitionNames counts only the left-margin
// blocks and the labels after a "%%" closer, so a quoted definition never
// meets its twin.

beforeEach(resetNotices);

describe("a quoted and a column-0 definition of one name", () => {
    it.fails("Merge off: the duplicate alert names it", () => {
        const note = ["a[^a] b", "", "> [^a]: one", "", "[^a]: two"];
        noticeLintAlerts(fakePlugin({ ...DEFAULT_SETTINGS }), note.join("\n"));
        // Today: no alert at all.
        expect(messages().some((m) => m.includes("more than once"))).toBe(true);
    });
});
