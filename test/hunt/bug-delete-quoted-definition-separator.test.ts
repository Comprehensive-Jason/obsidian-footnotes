import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// BUG (cosmetic): deleting a definition inside a blockquote leaves a
// doubled or dangling ">" line.
//
// What the user would see: a blockquote holds "> a", a ">" line, the
// definition "> [^q]: x" with "> more", another ">" line and "> b".
// Delete footnote everywhere on footnote q leaves two ">" lines in a row
// between "> a" and "> b". When the definition ends the quote, a lone ">"
// is left hanging at the bottom of the quote. Reading view shows the same
// text, but the note's source has a stray line.
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D13.
//
// Source of truth: the delete already merges the empty lines around a
// removed definition outside a quote, leaving one blank line; the quoted
// case should leave one blank quote line the same way.
//
// Cause: removeLineRanges merges only "" lines, never a bare ">".

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("deleting a quoted definition", () => {
    it.fails("between quoted paragraphs leaves one blank quote line, not two", () => {
        // Today: "p\n\n> a\n>\n>\n> b".
        expect(md(["p[^q]", "", "> a", ">", "> [^q]: x", "> more", ">", "> b"], "q")).toBe("p\n\n> a\n>\n> b");
    });

    it.fails("at the end of its quote leaves no dangling '>' line", () => {
        // Today: "p\n\n> a\n>\n\nafter".
        expect(md(["p[^q]", "", "> a", ">", "> [^q]: x", "", "after"], "q")).toBe("p\n\n> a\n\nafter");
    });
});
