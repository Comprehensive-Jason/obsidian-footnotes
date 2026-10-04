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
//
// SETTLED 2026-10-03 (the runtime swap, step 4), against the live app:
// Obsidian reads "Notes:" over "- " as a paragraph and an EMPTY LIST ITEM,
// not a heading (its sections for swap34:d5-bare-dash-space are a
// paragraph on line 1 and a list on line 2, and for
// swap34:d5-dash-space-then-item a paragraph and a two-item list; saved in
// test/obsidian-answers/swap34-probes.json). Only a bare "-" with nothing
// after it underlines: "Notes:" over "-" is a heading
// (swap34:d5-bare-dash). micromark, the source of truth this pin was
// written against, reads it differently from Obsidian. The deletion
// leaves "- " with its space, so the paragraph stays a paragraph and the
// bullet stays (Jason's ruling, db29b09), and these expectations now say
// so; they used to expect the deletion to be refused or reworded.

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("emptying a marker-line definition right under a paragraph", () => {
    it("keeps the bullet, and the paragraph stays a paragraph over an empty list item", () => {
        const out = md(["Notes:", "- [^i]: defined in the list", "", "p[^i]"], "i");
        expect(out).toBe("Notes:\n- \n\np");
    });

    it("the same under a paragraph followed by another item", () => {
        const out = md(["text", "- [^i]: first", "- other item", "", "p[^i]"], "i");
        expect(out).toBe("text\n- \n- other item\n\np");
    });
});
