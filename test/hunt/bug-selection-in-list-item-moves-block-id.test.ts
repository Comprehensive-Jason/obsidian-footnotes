import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";

// Bug (wrong text written): a selection that ends with a list item's block
// id, and starts in the item's text on an earlier line, moves the block id
// into the footnote. Links to the item then point into the footnote, or at
// nothing.
//
// A "block id" is the " ^id" Obsidian writes at the end of a block when the
// user copies a link to it.
//
// The note:
//     Intro.
//
//     - The tide «rose early
//       and fell late ^tide1»
//     - next
// Selection: "rose early" on line 2 through the end of line 3, block id
// included (a drag to the end of the item, or Shift+End). Settings at their
// defaults, the numbered key.
//
// What happens: "- The tide[^1]" and
//     [^1]: rose early
//           and fell late ^tide1
// The id left the item and now ends the footnote's block.
//
// What should happen: the id stays at the end of the item, as it does for
// every other selection that keeps the line's marker:
//     - The tide[^1] ^tide1
//     [^1]: rose early
//           and fell late
//
// Why: README, "Turn selected text into a footnote": "A block id at the end
// of the selection stays on the line, so links to the block keep working."
// Jason's ruling Q32 (2026-10-09, test/hunt/spec-selection-moves-block-id-into-footnote):
// only a selection that takes the line's own marker ("- ", "> ", "# ")
// takes the id with it. This selection starts in the item's text and takes
// no marker. The same selection in a plain paragraph keeps the id (the
// characterization test below), and so does a one-line selection in the
// item.
//
// Cause: src/commands/selection-footnote.ts:465. `keepsMarker` asks whether
// the selection starts at or after the end of the block syntax on its LAST
// line, and for a selection over several lines it takes the start as column
// 0 of that line. A list item's continuation line begins with the item's
// indentation and a quote's with "> ", which blockSyntaxEnd counts, so
// every selection over several lines inside an item or a quote is taken to
// have "taken the marker", wherever it started.
//
// Found by the Fable 5.2 review (2026-11-11); Jason chose to fix it.

beforeEach(resetNotices);

/** Selects from `from` to `to`, presses the numbered key, and returns the note after and the notices. */
async function convert(lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) {
    const doc = fakeEditor([...lines], { cursor: to, selection: { anchor: from, head: to }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, doc));
    return { after: doc.lines, notices: messages() };
}

describe("a selection inside a list item that ends with the item's block id", () => {
    it("over two lines of the item, leaves the block id on the item", async () => {
        const before = ["Intro.", "", "- The tide rose early", "  and fell late ^tide1", "- next"];
        const { after, notices } = await convert(before, { line: 2, ch: 11 }, { line: 3, ch: 22 });
        expect(notices).toEqual([]);
        // Today: the definition's last line is "      and fell late ^tide1"
        // and no other line holds the id.
        const definitionAt = after.findIndex((line) => line.startsWith("[^1]:"));
        expect(after.slice(definitionAt).join("\n")).not.toContain("^tide1");
        expect(after.slice(0, definitionAt).join("\n")).toContain("^tide1");
    });

    // Characterization: the shapes that already keep the id.
    it("the same selection in a plain paragraph keeps the id on the line (as it is today)", async () => {
        const before = ["The tide rose early", "and fell late ^tide1", "", "After."];
        const { after } = await convert(before, { line: 0, ch: 9 }, { line: 1, ch: 20 });
        expect(after).toEqual(["The tide[^1] ^tide1", "", "After.", "", "[^1]: rose early", "    and fell late"]);
    });

    it("a one-line selection in the item keeps the id on the line (as it is today)", async () => {
        const before = ["- The tide rose early ^tide1", "- next"];
        const { after } = await convert(before, { line: 0, ch: 11 }, { line: 0, ch: 28 });
        expect(after).toEqual(["- The tide[^1] ^tide1", "- next", "", "[^1]: rose early"]);
    });
});
