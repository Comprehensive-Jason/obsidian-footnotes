import { describe, expect, it } from "vitest";
import { readNote } from "../../src/parsing/note-reading";


// BUG (wrong output): a code fence inside a list item inside a blockquote
// never ends with its item, so it hides the rest of the quote.
//
// What the user would see: a blockquote holds a list item "> - item", a
// blank quote line, and a fence ">   ```" with ">   code" that is never
// closed. After another blank quote line, "> [^1]: x" sits back at the
// quote's own margin, outside the item, so the item and its fence have
// ended. The plugin still reads "> [^1]: x" as code: footnote 1 has no
// definition to it, and the lint and the commands leave the line alone.
//
// Needs a Reading-view check: the unquoted list-item case was probed, the
// quoted one has not been yet.
//
// Hunt 2026-10-02, round 2, lens context. Cluster X3.
//
// Source of truth: CommonMark (after a blank line, a line indented less
// than the item's content column ends the item, here at indent 0 against
// 2) and the plugin's own fence-in-item rule ("a fence lives in the
// container that opened it", bug-gen-list-fence-outlives-item).
//
// Cause: the scanner tracks the item's column (listColumn) only at quote
// depth 0, so inside a quote it is null and the fence never dies with its
// item.

describe("a fence inside a quoted list item", () => {
    it("ends at the quoted line under the item's margin after a blank quote line", () => {
        const lines = "> - item\n>\n>   ```\n>   code\n>\n> [^1]: x\n\nuse[^1]".split("\n");
        const reading = readNote(lines);
        const starts = readNote(lines).labelLines;
        expect(reading.protectedLines[5]).toBe(false);
        expect(starts[5]).toBe(true);
    });
});
