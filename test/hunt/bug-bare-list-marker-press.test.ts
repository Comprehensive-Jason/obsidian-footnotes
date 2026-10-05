import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { BlockSyntaxNotice } from "../../src/editor/notice";

// BUG (annoyance): a press at the end of an empty list item with no space
// after its marker glues the footnote onto the marker, and the item stops
// being an item.
//
// What the user would see: a line holding just "-" (or "*", "+", "1.",
// "1)") is an empty list item to Obsidian. With the caret at its end, a
// press writes "-[^1]", which is a plain paragraph, not a bullet. Under
// "- item", the new "-[^1]" even joins the first item's text ("item
// -[^1]").
//
// The remedy was Jason's pick between refusing the press with the
// block-syntax notice, as an empty heading "#" already does in the same
// spot, and writing a space first so the item stays an item ("- [^1]").
// Decided 2026-10-05 (triage decision Q2): refuse. The tests accepted
// either until then.
//
// Hunt 2026-10-05, round 1, lens refusals. Cluster RF4.
//
// Source of truth: Obsidian's list tokenizer takes a marker followed by
// the end of the line as an item (the "$" branch of
// /^([ \t]*)([*+-]|\d+[.)])( {1,4}(?! )| |\t|$|(?=\n))/ in its app.js),
// and so does the plugin's reader; the block-syntax ruling of 2026-10-03
// (a press never writes into block syntax).
//
// Cause: blockSyntaxEnd (the column where a line's block syntax ends and
// its text begins) is the end of the line here, so the caret sits right
// at it and the block-syntax guard lets the press through.

const Settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

type Press = typeof insertAutonumFootnote;

beforeEach(resetNotices);

describe("a press at the end of an empty list item with no space after its marker", () => {
    for (const [lines, line] of [
        [["-"], 0],
        [["*"], 0],
        [["+"], 0],
        [["1."], 0],
        [["1)"], 0],
        [["- item", "-"], 1],
        [["1. a", "2."], 1],
    ] as [string[], number][]) {
        for (const [name, fn] of [["numbered", insertAutonumFootnote], ["named", insertNamedFootnote], ["inline", insertInlineFootnote]] as [string, Press][]) {
            it(`${name} key on ${JSON.stringify(lines)} line ${line}`, async () => {
                const doc = fakeEditor([...lines], { cursor: { line, ch: lines[line].length }, edits: true, wholeDoc: true, words: true });
                await fn(fakePlugin(Settings, doc));
                // Before the fix, for example: "-[^1]".
                expect(doc.lines).toEqual(lines);
                expect(messages()).toEqual([BlockSyntaxNotice]);
            });
        }
    }
});
