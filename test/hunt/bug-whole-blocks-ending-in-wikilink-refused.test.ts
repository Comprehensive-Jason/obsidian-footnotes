import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (wrong output): a selection of whole blocks whose last line ends in
// a wikilink or an embed is refused, and nothing is written.
//
// What the user would see: "Para one here.", a blank line, "- [[Note A]]",
// "- [[Note B]]". They select both bullets whole, from the start of the
// first to the end of the last, and press the numbered key. The press is
// refused with "No footnote was created: the selection takes part of the
// line's formatting. Select the whole line, or only its text." They did
// select the whole lines. The same list with "- Note A" and "- Note B"
// converts: "[^1]" takes the list's place, and the footnote holds the
// list. The same refusal comes for a "See also:" line over a list of
// wikilinks, a quote whose last line ends in "[[Smith 2020]]", a list of
// "![[reef-01.jpg]]" images, and a numbered list ending in a wikilink
// selected by a triple-click dragged down a line.
//
// A "wikilink" is Obsidian's link to another note, "[[Note A]]"; an
// "embed" is the same with a "!" in front, which shows the note or the
// image in place. The "result gate" is the one check every edit passes
// before it is written: the note after must read the same as the note
// before, except for what the edit meant to change.
//
// Hunt 2026-10-08, cycle 7. Cluster Y1.
//
// Origin: green at 97abeac, this cycle's origin. A regression from
// 0e57ecb (2026-10-08, Jason's ruling Q25 extended), built on the
// holdsTextOfLast test that 86d8d16 added the same day.
//
// Source of truth: Jason's ruling Q25, extended (sprout-c6-rulings.md 2,
// 2026-10-08): "A selection of whole blocks still converts." 0e57ecb's
// commit message says the same. The controls below, the same blocks
// ending in plain text, convert.
//
// Cause: the result gate's holdsTextOfLast (src/editor/result-gate.ts)
// asks whether the line a selection across lines leaves still holds text
// of the last line it took. One part of that test is whether the two lines
// end in the same character. A selection of whole blocks leaves "[^1]"
// alone on its line. Compared without its footnotes that line is empty, so
// lineKey (src/editor/document-diff.ts) falls back to "[^1]" itself, which
// ends in "]", as a last line ending in a wikilink or an embed does. The
// gate then takes "[^1]" for what is left of that last line, sees that it
// no longer starts a list item or sits in the quote, and refuses.

const settings = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
    expandSelectionToWholeWords: true,
};

/** Selects from `anchor` to `head` in a note of `lines`, presses the numbered key, and returns the lines after. */
async function pressOver(lines: string[], anchor: EditorPosition, head: EditorPosition): Promise<string[]> {
    const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, words: true, cursor: head, selection: { anchor, head } });
    await insertAutonumFootnote(fakePlugin(settings, doc));
    return doc.lines;
}

/** The end of line `line`. */
const end = (lines: string[], line: number) => ({ line, ch: lines[line].length });

/** The notices that refused a creation. */
const refusals = () => messages().filter((m) => m.startsWith("No footnote"));

beforeEach(resetNotices);

describe("a selection of whole blocks whose last line ends in a wikilink or an embed", () => {
    it("control: a list of plain bullets selected whole converts", async () => {
        const lines = ["Para one here.", "", "- Note A", "- Note B"];
        const out = await pressOver(lines, { line: 2, ch: 0 }, end(lines, 3));
        expect(refusals()).toEqual([]);
        expect(out.slice(0, 3)).toEqual(["Para one here.", "", "[^1]"]);
    });

    it("control: a quote ending in plain text, selected whole, converts", async () => {
        const lines = ["Intro.", "", "> The reef grew back.", "> From Smith 2020", "", "After."];
        const out = await pressOver(lines, { line: 2, ch: 0 }, end(lines, 3));
        expect(refusals()).toEqual([]);
        expect(out.slice(0, 4)).toEqual(["Intro.", "", "[^1]", ""]);
    });

    // Now each of these is refused with "No footnote was created: the
    // selection takes part of the line's formatting. Select the whole
    // line, or only its text.", and the note is unchanged.
    it.fails("a list of wikilink bullets selected whole converts", async () => {
        const lines = ["Para one here.", "", "- [[Note A]]", "- [[Note B]]"];
        const out = await pressOver(lines, { line: 2, ch: 0 }, end(lines, 3));
        expect(refusals()).toEqual([]);
        expect(out.slice(0, 3)).toEqual(["Para one here.", "", "[^1]"]);
        expect(out).toContain("[^1]: - [[Note A]]");
    });

    it.fails("a 'See also' line with its list of wikilinks, selected whole, converts", async () => {
        const lines = ["The tide rose fast.", "", "See also:", "- [[Oyster biology]]", "- [[Reef restoration]]"];
        const out = await pressOver(lines, { line: 2, ch: 0 }, end(lines, 4));
        expect(refusals()).toEqual([]);
        expect(out.slice(0, 3)).toEqual(["The tide rose fast.", "", "[^1]"]);
    });

    it.fails("a quote ending in a wikilink, selected whole, converts", async () => {
        const lines = ["Intro.", "", "> The reef grew back.", "> From [[Smith 2020]]", "", "After."];
        const out = await pressOver(lines, { line: 2, ch: 0 }, end(lines, 3));
        expect(refusals()).toEqual([]);
        expect(out.slice(0, 4)).toEqual(["Intro.", "", "[^1]", ""]);
    });

    it.fails("a list whose last bullet is an embed, selected whole, converts", async () => {
        const lines = ["Photos from the reef:", "", "- ![[reef-01.jpg]]", "- ![[reef-02.jpg]]", "", "More text."];
        const out = await pressOver(lines, { line: 2, ch: 0 }, end(lines, 3));
        expect(refusals()).toEqual([]);
        expect(out.slice(0, 4)).toEqual(["Photos from the reef:", "", "[^1]", ""]);
    });

    // The triple-click selects each line with its line break, so the
    // selection ends at the start of the blank line under the list.
    it.fails("a numbered list ending in a wikilink, triple-clicked over two lines, converts", async () => {
        const lines = ["Steps:", "", "1. Read [[Paper A]]", "2. Read [[Paper B]]", "", "Done."];
        const out = await pressOver(lines, { line: 2, ch: 0 }, { line: 4, ch: 0 });
        expect(refusals()).toEqual([]);
        expect(out[2]).toBe("[^1]");
    });
});
