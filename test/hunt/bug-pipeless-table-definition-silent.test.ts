// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 2 of 5 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { beforeEach, describe, expect, it } from "vitest";

import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

import { noticeLintAlerts, definitionsInsideTableNames } from "../../src/linting/lint-alerts";
import { tableRowLinesOf } from "../../src/parsing/markdown-scan";

// A definition label wedged between two rows of a table breaks the table
// either way (Obsidian ends the table at the label and folds the rows
// after it into the footnote's text), so the plugin does not move such a
// label: it names it in an alert instead (Jason's ruling A2, 2026-09-15).
// But the alert's idea of a table row is its own regex, `TableRow`, which
// insists on OUTER pipes ("| a | b |"). The scanner's table reader -
// tableRowLinesOf, and tableRowLines in the editor, which agree - has
// accepted pipe-less GFM rows ("a | b" + "--- | ---") since the
// pipeless-table pin (bug-label-after-pipeless-table). So the same
// breaking label inside a pipe-less table is never reported, while the
// identical shape with outer pipes is.
//
// What the user sees: in "a | b\n--- | ---\n[^1]: x\nc | d", Reading view
// folds "c | d" into the footnote's text, breaking the table - and the
// lint says nothing, while the piped twin gets the "footnote definition
// inside a table" alert. The alert's docstring even claims "the scanner's
// definition-start rule uses the same shape"; it no longer does.
//
// Source of truth: GFM's table extension (outer pipes optional; the
// pin in bug-label-after-pipeless-table records Obsidian's agreement)
// + Jason's ruling A2 (2026-09-15: the plugin tells the user about a
// definition inside a table) + ADR-0002 (never silent).
//
// Settings involved: none; this alert always speaks when it has something
// to say.

const PIPELESS = "a | b\n--- | ---\n[^1]: x\nc | d\n\nuse[^1]";

describe("a definition label inside a pipe-less GFM table", () => {
    beforeEach(resetNotices);

    it("the scanner reads the pipe-less rows as a table (the pinned reading)", () => {
        const lines = PIPELESS.split("\n");
        expect(tableRowLinesOf(lines).slice(0, 2)).toEqual([true, true]);
    });

    it("is named by the definitions-inside-tables alert, like the piped twin", () => {
        expect(definitionsInsideTableNames(PIPELESS)).toEqual(["1"]);
    });

    it("the lint alert fires for it", () => {
        noticeLintAlerts(fakePlugin({}), PIPELESS);
        expect(messages().some((m) => m.includes("[^1]:"))).toBe(true);
    });

    it("control: the piped twin IS named (the existing behavior)", () => {
        expect(definitionsInsideTableNames("| a | b |\n| --- | --- |\n[^1]: x\n| c | d |\n\nuse[^1]")).toEqual(["1"]);
    });

    it("control: a label below a table, nothing below it, is not inside anything", () => {
        expect(definitionsInsideTableNames("a | b\n--- | ---\n[^1]: x\n\nuse[^1]")).toEqual([]);
    });
});
