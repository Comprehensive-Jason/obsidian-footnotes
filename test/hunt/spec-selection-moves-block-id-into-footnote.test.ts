// spec question Q32 (cluster V4): a selection that ends with the line's
// block id moves the id into the footnote. Should the id stay on the line?
//
// What it does now: "- An item ^i1" / "- Another item" / "" / "See
// [[#^i1]]." (Obsidian writes " ^i1" itself on Copy link to block). The
// user triple-clicks the first item and presses the numbered key. Result:
// "- [^1]" with "[^1]: An item ^i1". Live (sprout Obsidian 1.14.4,
// 2026-10-09): Obsidian now registers block i1 on the footnote's own line,
// so [[#^i1]] points into the footnote's text instead of the item. The
// same for a quote line and for a drag from a word to the line's end.
// Options: (a) the id stays at the line's end: "- [^1] ^i1" with "[^1]: An
// item" (live: i1 stays on the item); (b) refuse a selection that ends
// with a block id; (c) leave it: the user selected the id.
// This file asserts (a) or (b): the id stays on the line, or nothing
// changes.
//
// Hunt 2026-10-09, cycle 8, lens presses and selections. Source: rule D4;
// cluster Z12 and its live answers (a block id must stay at its block's
// end for links to it); ruling Q27 keeps the line's own syntax on the line.
// Origin: pre-existing (red at 34d5377 and 3a47f7a).

// a selection conversion carries the
// line's block id into the footnote, and the line loses it. The selection
// twin of cluster Z12 (pin bug-press-after-block-id).
//
// "- An item ^i1", with "[[#^i1]]" linking to it from elsewhere. Obsidian
// adds such an id itself when the user copies a link to the block. The user
// triple-clicks the item and presses the numbered key. Ruling Q27 keeps the
// item's "- " on the line and moves its text into the footnote, but the
// block id goes along with the text: "- [^1]" with "[^1]: An item ^i1". The
// item has no block id any more, so the link no longer goes to it. The same
// happens to a quote line selected whole, and to a drag from a word of a
// paragraph to the line's end ("Oysters[^1]" with "[^1]: filter water.
// ^water1"). (A whole paragraph selected and converted is left out: there
// the whole block moves into the footnote, and taking its id along is
// arguable.)
//
// Source of truth: docs/obsidian-reading-rules.md D4 (a block id counts
// only at the very end of its block) and the live answers c6:z12-after-id
// and c6:z12-before-id behind pin bug-press-after-block-id, where a press
// that moved the id off the paragraph's end was confirmed a bug: "every
// [[Note#^water1]] link to that paragraph ... stops resolving". Whether a
// block id at the end of a footnote's text registers a block at all is not
// in the saved answers (needsLiveOracle); either way the paragraph the
// link was made to has lost its id. Fix-shape-neutral: the line keeps
// ending in its block id, or the note is left as it was.
import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

type Pos = { line: number; ch: number };
const settings = { ...DEFAULT_SETTINGS, enablePopupEditor: false };

async function select(lines: string[], anchor: Pos, head: Pos) {
    const doc = fakeEditor(lines, { cursor: head, selection: { anchor, head }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(settings, doc));
    return doc;
}

beforeEach(resetNotices);

describe("a selection that ends with the line's block id", () => {
    const cases: [string, string[], Pos, Pos, string][] = [
        ["a drag from a word to the line's end", ["Oysters filter water. ^water1", "", "See [[#^water1]]."], { line: 0, ch: 8 }, { line: 0, ch: 29 }, " ^water1"],
        ["a list item selected whole (ruling Q27's shape)", ["- An item ^i1", "- Another item", "", "See [[#^i1]]."], { line: 0, ch: 0 }, { line: 0, ch: 13 }, " ^i1"],
        ["a quote line selected whole", ["> A quote worth keeping. ^q1", "", "See [[#^q1]]."], { line: 0, ch: 0 }, { line: 0, ch: 28 }, " ^q1"],
    ];
    for (const [name, lines, anchor, head, id] of cases) {
        it.fails(`${name}: the line keeps its block id at its end`, async () => {
            const doc = await select(lines, anchor, head);
            expect(doc.lines[0].endsWith(id)).toBe(true);
        });
    }

    it("control: a selection that stops before the block id leaves the id on the line", async () => {
        const doc = await select(["Oysters filter water. ^water1", "", "See [[#^water1]]."], { line: 0, ch: 8 }, { line: 0, ch: 21 });
        expect(doc.lines[0]).toBe("Oysters[^1] ^water1");
    });
});
