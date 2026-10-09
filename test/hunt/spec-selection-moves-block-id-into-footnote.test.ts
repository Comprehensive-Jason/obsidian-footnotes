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
// This file asserted (a) or (b): the id stays on the line, or nothing
// changes.
//
// Answered (Jason's ruling Q32, 2026-10-09), option (a): the selection
// converts the text in front of the id, and the id stays at the line's
// end, so links keep pointing at the item: "- An item ^i1" selected whole
// gives "- [^1] ^i1" with "[^1]: An item"; the same for a quote line and a
// drag from a word to the line's end, as cluster Z12 did for presses. The
// tests below were it.fails until then and now assert the decided result
// exactly; what the selection did before is described above.
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

import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";
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
    const cases: [string, string[], Pos, Pos, string, string][] = [
        ["a drag from a word to the line's end", ["Oysters filter water. ^water1", "", "See [[#^water1]]."], { line: 0, ch: 8 }, { line: 0, ch: 29 }, "Oysters[^1] ^water1", "[^1]: filter water."],
        ["a list item selected whole (ruling Q27's shape)", ["- An item ^i1", "- Another item", "", "See [[#^i1]]."], { line: 0, ch: 0 }, { line: 0, ch: 13 }, "- [^1] ^i1", "[^1]: An item"],
        ["a quote line selected whole", ["> A quote worth keeping. ^q1", "", "See [[#^q1]]."], { line: 0, ch: 0 }, { line: 0, ch: 28 }, "> [^1] ^q1", "[^1]: A quote worth keeping."],
    ];
    for (const [name, lines, anchor, head, line, definition] of cases) {
        it(`${name}: the text goes into the footnote, and the line keeps its block id at its end`, async () => {
            const doc = await select(lines, anchor, head);
            expect(doc.lines[0]).toBe(line);
            expect(doc.lines).toContain(definition);
            expect(readNote(doc.lines).definitions.map((found) => found.name)).toEqual(["1"]);
        });
    }

    it("a selection that ends inside the block id converts the text in front of it", async () => {
        const doc = await select(["- An item ^i1", "", "See [[#^i1]]."], { line: 0, ch: 2 }, { line: 0, ch: 11 });
        expect(doc.lines[0]).toBe("- [^1] ^i1");
        expect(doc.lines).toContain("[^1]: An item");
    });

    it("the inline key leaves the block id at the line's end too", async () => {
        const doc = fakeEditor(["Oysters filter water. ^water1"], { cursor: { line: 0, ch: 29 }, selection: { anchor: { line: 0, ch: 8 }, head: { line: 0, ch: 29 } }, edits: true, wholeDoc: true, words: true });
        await insertInlineFootnote(fakePlugin(settings, doc));
        expect(doc.lines[0]).toBe("Oysters^[filter water.] ^water1");
    });

    // Not in the ruling's examples; the rule as written covers it: a whole
    // paragraph's text goes into the footnote, and the id stays on the
    // line where the paragraph was, now holding the reference.
    it("a whole paragraph over two lines: the id stays on the reference's line", async () => {
        const doc = await select(["Intro.", "", "Line one", "line two ^p1", "", "See [[#^p1]]."], { line: 2, ch: 0 }, { line: 3, ch: 12 });
        expect(doc.lines.slice(0, 3)).toEqual(["Intro.", "", "[^1] ^p1"]);
        expect(doc.lines.slice(-2)).toEqual(["[^1]: Line one", "    line two"]);
    });

    // A selection that takes a line's own marker takes whole blocks (ruling
    // Q25), and the id goes with them, as before the ruling: left behind,
    // " ^x" would stand alone where the item was.
    it("control: a whole list, its last item ending with an id, moves into the footnote with the id", async () => {
        const doc = await select(["Intro.", "", "- a", "- b ^x", "", "After."], { line: 2, ch: 0 }, { line: 3, ch: 6 });
        expect(doc.lines).toEqual(["Intro.", "", "[^1]", "", "After.", "", "[^1]: - a", "    - b ^x"]);
    });

    it("control: a selection that stops before the block id leaves the id on the line", async () => {
        const doc = await select(["Oysters filter water. ^water1", "", "See [[#^water1]]."], { line: 0, ch: 8 }, { line: 0, ch: 21 });
        expect(doc.lines[0]).toBe("Oysters[^1] ^water1");
    });
});
