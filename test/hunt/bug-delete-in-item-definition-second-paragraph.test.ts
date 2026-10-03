import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// BUG (wrong output): deleting a list-item definition whose text runs on
// into a second paragraph removes only the first line, and the second
// paragraph turns into a code block.
//
// What the user would see: the list item "- [^i]: first" is followed by a
// blank line and "      second paragraph of i", indented to the item's
// text plus four spaces, so Reading view shows it as footnote i's second
// paragraph. Delete footnote everywhere on footnote i leaves "- " and the
// indented line. With the definition gone, that line is an indented code
// block (text indented four spaces or more, shown as code) inside the
// empty bullet.
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D6.
//
// Source of truth: spec-label-after-list-marker (verified in Reading view
// 2026-09-16: "a continuation indented to the item's content column plus
// four does" join the footnote), and micromark agrees. The same definition
// under the item, rather than on the bullet's line, is already refused by
// linesReadDifferently.
//
// Cause: the marker-line path skips the read-differently guards and cuts
// only the label line.

// Deletes footnote `name` from `lines` and returns the note, or "<<refused: reason>>" and the like.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}${plan.kind === "refused" ? ": " + plan.reason : ""}>>`;
}

describe("an in-item definition whose text runs on after a blank line", () => {
    it("is refused or taken whole", () => {
        const out = md(["- [^i]: first", "", "      second paragraph of i", "", "p[^i]"], "i");
        // Today: "- \n\n      second paragraph of i\n\np".
        expect(out.startsWith("<<refused") || out === "- \n\np").toBe(true);
    });
});
