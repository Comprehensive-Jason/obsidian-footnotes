import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// spec question: when a "%%" comment opens right under a definition and
// never closes, should delete footnote everywhere refuse, rather than
// delete everything to the end of the note?
//
// What it does now: under "[^1]: x" comes a lone "%%" at column 0 that is
// never closed, then "comment to the end", a blank line and "after".
// Obsidian hides everything from the "%%" on. The plugin counts the open
// comment as part of footnote 1, so Delete footnote everywhere removes
// every line to the end of the note, "after" included.
// What a user might expect: the delete removes "[^1]: x" alone, or refuses
// with a toast because the footnote runs to the end of the note through
// an unclosed region.
// Why it is a question and not a bug: Obsidian hides those lines either
// way, so the user cannot see them; but they are still text in the file,
// and the delete removes them for good. Whether text hidden by an open
// comment counts as the user's text to keep is Jason's call.
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D2.
//
// Source of truth: spec-obsidian-comments (a "%%" block lives in the
// container that opened it, and an unclosed block runs to the end of the
// note).

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("spec question: an unclosed %% opened right under the label line", () => {
    it.fails("keeps the lines after the comment, or refuses", () => {
        const out = md(["p[^1]", "", "[^1]: x", "%%", "comment to the end", "", "after"], "1");
        expect(out).toContain("after");
    });
});
