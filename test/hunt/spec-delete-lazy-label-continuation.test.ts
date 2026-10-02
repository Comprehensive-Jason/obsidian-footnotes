import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// spec question: when delete footnote everywhere removes a lazy label,
// should the line under it go too?
//
// What it does now: "prose[^l] here" is followed directly by
// "[^l]: one blank line short" and "and its second line". The middle line
// is a lazy label (a line under prose that looks like a definition but is
// read as paragraph text). The delete treats it as the definition the
// user meant and removes it, but leaves "and its second line" glued under
// the prose.
// What a user might expect: the line under the lazy label goes with it,
// because the fix for lazy labels would make that line the definition's
// lazy continuation (a line that carries on the definition without being
// indented).
// Why it is a question and not a bug: to Obsidian all three lines are one
// paragraph, so "and its second line" is prose today. Treating it as part
// of the footnote is a guess about what the user meant, the same guess
// the delete already makes for the label.
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D12.
//
// Source of truth: the fix-lazy lint rule (it adds a blank line above a
// lazy label, which makes the line under it the definition's
// continuation).

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("spec question: a lazy label's own continuation line", () => {
    it.fails("goes with the lazy label", () => {
        expect(md(["prose[^l] here", "[^l]: one blank line short", "and its second line", "", "after"], "l")).toBe(
            "prose here\n\nafter",
        );
    });
});
