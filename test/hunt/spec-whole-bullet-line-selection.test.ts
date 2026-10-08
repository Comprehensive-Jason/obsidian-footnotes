import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// spec question: a whole bullet line is selected (a triple-click on
// "- First point", which selects the line and its line break) and the
// numbered key pressed. What should happen?
//
// What it does now: for the first bullet of a list, the press is refused
// with "No footnote was created: the selection takes part of the line's
// formatting. Select the whole line, or only its text." The user did
// select the whole line, so the advice names the selection they made. For
// the second bullet the press converts, but the line it leaves has no
// "- " ("- First point", "[^1]", "- Third point"), so Obsidian reads
// "[^1]" as more of the first bullet's text: footnote 1 shows at the end
// of "First point", and the list has lost a bullet. Footnote 1 holds
// "- Second point", a list inside the footnote. The first line of a
// two-line quote ("> One.", "> Two.") is refused the way the first bullet
// is.
// What a user might expect: what selecting the item's text alone does,
// which works today: the bullet stays, its text moves into the footnote,
// and the bullet holds the reference ("- [^1]").
//
// Options:
// (a) Treat it as a selection of the item's text: the bullet stays, its
//     text moves into the footnote, and the reference stays on the bullet
//     ("- [^1]"), for the first, a middle, and the last bullet alike
//     (recommended: it is what selecting the text alone does, and it is
//     what the user most likely means).
// (b) Move the whole bullet into the footnote and say so.
// (c) Refuse every whole-bullet selection with a notice that fits
//     ("Select only the item's text.").
//
// Why it is a question and not a bug: the notice's ruling (28c5cdc,
// Jason's pick 2026-10-08) covers a selection that takes a line's "> ",
// "- ", or "# " and leaves the rest of the line behind, and says a whole
// "# Heading here" still converts. Nothing settles what a whole bullet
// line selected should do, so which of the three it is is Jason's call.
// The refusal of the first bullet shares its root with cluster Z19 (the
// result gate compares which line starts a list or quote). The "result
// gate" is the one check every edit passes before it is written: the note
// after must read the same as the note before, except for what the edit
// meant to change.
//
// Source of truth: SelectionFormattingNotice's ruling (28c5cdc); ADR 0003
// (an edit is refused unless the note reads the same apart from what it
// meant to change); docs/obsidian-reading-rules.md B4 (text at the start
// of a line right under an item's paragraph is more of that paragraph).
//
// The tests assert option (a).
//
// Hunt 2026-10-08, cycle 6. Cluster Z11, triage question Q27.
//
// Origin: the second bullet's reference read as the first bullet's text is
// pre-existing; the first bullet's refusal came with 99d4e6d, where the
// result gate took over the selection's refusals, and its wording with
// 28c5cdc.

const Settings = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    expandSelectionToWholeWords: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

/** Selects from `from` to `to` on one line and presses the numbered key. */
async function selectText(lines: string[], line: number, from: number, to: number) {
    const doc = fakeEditor(lines, { cursor: { line, ch: to }, selection: { anchor: { line, ch: from }, head: { line, ch: to } }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(Settings, doc));
    return doc;
}

/** Selects line `line` whole, with its line break, as a triple-click does, and presses the numbered key. */
async function tripleClick(lines: string[], line: number) {
    const doc = fakeEditor(lines, { cursor: { line: line + 1, ch: 0 }, selection: { anchor: { line, ch: 0 }, head: { line: line + 1, ch: 0 } }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(Settings, doc));
    return doc;
}

/**
 * Whether the line holding the reference [^1] starts a block of its own,
 * so it does not read as more of the line above. The reading marks a line
 * that starts a block with "^" in its lineBlocks.
 */
function referenceLineStartsABlock(lines: string[]): boolean {
    const at = lines.findIndex((text) => text.includes("[^1]") && !text.startsWith("[^1]:"));
    return at !== -1 && (readNote(lines).lineBlocks[at] ?? "").includes("^");
}

const list = ["Intro.", "", "- First point", "- Second point", "- Third point", "", "After."];

beforeEach(resetNotices);

describe("a whole bullet line selected and the numbered key pressed", () => {
    it("control: the text of the first bullet alone converts, the bullet kept", async () => {
        const doc = await selectText(list, 2, 2, 13);
        expect(doc.lines).toEqual(["Intro.", "", "- [^1]", "- Second point", "- Third point", "", "After.", "", "[^1]: First point"]);
        expect(messages()).toEqual([]);
    });

    it("control: the text of the second bullet alone converts, the bullet kept", async () => {
        const doc = await selectText(list, 3, 2, 14);
        expect(doc.lines).toEqual(["Intro.", "", "- First point", "- [^1]", "- Third point", "", "After.", "", "[^1]: Second point"]);
        expect(messages()).toEqual([]);
    });

    // Now: refused with the notice that says to select the whole line.
    it.fails("the first bullet: it converts as its text alone does", async () => {
        const doc = await tripleClick(list, 2);
        expect(doc.lines).toEqual(["Intro.", "", "- [^1]", "- Second point", "- Third point", "", "After.", "", "[^1]: First point"]);
        expect(referenceLineStartsABlock(doc.lines)).toBe(true);
    });

    // Now: "- First point", "[^1]", "- Third point", with "[^1]: - Second
    // point" at the end; the "[^1]" line reads as more of the first bullet.
    it.fails("the second bullet: it converts as its text alone does, and the reference does not read as more of the first bullet", async () => {
        const doc = await tripleClick(list, 3);
        expect(doc.lines).toEqual(["Intro.", "", "- First point", "- [^1]", "- Third point", "", "After.", "", "[^1]: Second point"]);
        expect(referenceLineStartsABlock(doc.lines)).toBe(true);
    });

    // The same choice for a quote line: the "> " stays and holds the
    // reference, as selecting "One." alone does today.
    // Now: refused with the notice that says to select the whole line.
    it.fails("the first line of a two-line quote: it converts as its text alone does", async () => {
        const doc = await tripleClick(["Intro.", "", "> One.", "> Two.", "", "After."], 2);
        expect(doc.lines).toEqual(["Intro.", "", "> [^1]", "> Two.", "", "After.", "", "[^1]: One."]);
    });
});
