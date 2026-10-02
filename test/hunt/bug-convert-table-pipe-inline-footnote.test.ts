import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { convertInlineFootnotesToNormal } from "../../src/commands/convert-footnotes";

// BUG (wrong output): in a table row, "^[a | b]" with a bare pipe is
// converted as one inline footnote, though the pipe splits it into two
// table cells.
//
// What the user would see: the row "| x^[a | b] | c |" shows three cells,
// "x^[a", "b]" and "c", with no footnote at all. Convert inline footnotes
// to normal rewrites the row to "| x[^1] | c |" and adds "[^1]: a | b":
// the table loses a cell and gains a footnote that was never there.
//
// Hunt 2026-10-02, round 2, lens convert. Cluster V4.
//
// Source of truth: the GFM table extension splits a row into cells at
// every unescaped pipe before it reads any inline syntax, even inside
// other inline spans. To keep a pipe inside a cell it has to be escaped
// ("\|"), and the escaped twin already converts correctly.

beforeEach(resetNotices);

describe("an inline footnote with a bare pipe in a table row", () => {
    it.fails("'^[a | b]' with a bare pipe in a table row is two cells, not an inline footnote, and stays", () => {
        const lines = ["| x^[a | b] | c |", "| - | - | - |"];
        const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
        convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
        // Today: "| x[^1] | c |", "| - | - | - |", "", "[^1]: a | b".
        expect(doc.lines).toEqual(lines);
    });
});
