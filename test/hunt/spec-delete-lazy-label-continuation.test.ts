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
// Characterization test (behaviour pinned as it is, 2026-11-05, when the spec
// pins were sorted under Jason's scope rule of 2026-10-07): a label with no blank
// line above it and a further line under it is rare, and keeping the line is
// the safe side of the guess, since to Obsidian it is the paragraph's text.
// It was it.fails until then.
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

describe("a lazy label's own continuation line", () => {
    it("characterization: stays under the prose", () => {
        expect(md(["prose[^l] here", "[^l]: one blank line short", "and its second line", "", "after"], "l")).toBe(
            "prose here\nand its second line\n\nafter",
        );
    });
});
