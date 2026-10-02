import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// BUG (wrong output): deleting a definition that sits on a bullet right
// under a paragraph leaves an empty "- " that turns the paragraph into a
// heading.
//
// What the user would see: the note reads "Notes:" with
// "- [^i]: defined in the list" under it. Delete footnote everywhere on
// footnote i leaves "Notes:" over "- ". An empty bullet cannot start a
// list under a paragraph, so the "-" is a setext underline (a line of "-"
// or "=" that makes the paragraph above it a heading), and "Notes:" now
// shows as a large H2 heading. The same happens when another item follows
// ("text", "- [^i]: first", "- other item").
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D5.
//
// Source of truth: CommonMark, checked with micromark and its GFM footnote
// extension: "Notes:\n- [^i]: text" is a paragraph and a list whose item
// holds a definition, while "Notes:\n- " is "<h2>Notes:</h2>". Jason's
// ruling in db29b09 ("the bullet stays") was made for a definition inside
// a list, not one directly under a paragraph.
//
// Cause: the marker-line path ("trimmed") keeps the bullet and skips both
// read-differently guards, so nothing notices the paragraph above has
// changed kind.

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("emptying a marker-line definition right under a paragraph", () => {
    it.fails("does not turn the paragraph into a heading", () => {
        const out = md(["Notes:", "- [^i]: defined in the list", "", "p[^i]"], "i");
        expect(out).not.toBe("Notes:\n- \n\np");
    });

    it.fails("the same under a paragraph followed by another item", () => {
        const out = md(["text", "- [^i]: first", "- other item", "", "p[^i]"], "i");
        expect(out).not.toBe("text\n- \n- other item\n\np");
    });
});
