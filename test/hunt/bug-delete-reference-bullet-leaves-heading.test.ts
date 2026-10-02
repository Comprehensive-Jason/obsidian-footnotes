import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// BUG (wrong output): cutting a reference that is a bullet's whole content,
// right under a paragraph, leaves a lone "-" that turns the paragraph into
// a heading.
//
// What the user would see: the note reads "Sources:" with "- [^1]" under
// it. Delete footnote everywhere on footnote 1 leaves "Sources:" over "-".
// A lone "-" under a paragraph is a setext underline (a line of "-" or
// "=" that makes the paragraph above it a heading), so "Sources:" now
// shows as a large H2 heading. The same happens inside a blockquote. The
// Delete orphaned references lint rule shares this cut, so it does the
// same to an orphaned reference.
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D3.
//
// Source of truth: CommonMark 0.31 sections 4.3 and 5.2, checked with
// micromark and its GFM footnote extension: "Sources:\n- [^1]" is a
// paragraph and a one-item list, while "Sources:\n-" is
// "<h2>Sources:</h2>" (an empty list item cannot interrupt a paragraph).
// The plugin's own blockEnder reads it as a heading too.
//
// Cause: cutOne, shared with the orphan-reference rule, empties the item,
// and the readsDifferently guard does not notice that the line above
// changed kind.

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("cutting a reference that is a bullet's whole content under a paragraph", () => {
    it.fails("does not make the paragraph a heading", () => {
        const out = md(["Sources:", "- [^1]", "", "[^1]: x"], "1");
        expect(out).not.toBe("Sources:\n-");
    });

    it.fails("the quoted twin: '> Sources:' over '> - [^1]'", () => {
        const out = md(["> Sources:", "> - [^1]", "", "[^1]: x"], "1");
        expect(out).not.toBe("> Sources:\n> -");
    });
});
