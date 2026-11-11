import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";
import { DEFAULT_SETTINGS } from "../../src/settings";

// Bug (wrong text written): a selection that runs over two lines of a
// quote's paragraph takes the second line's "> " into the footnote, so the
// footnote draws a quote box around half of a sentence.
//
// The note:
//     Intro.
//
//     > The tide «rose early
//     > and fell late» that day.
//
//     After.
// Selection: "rose early" on line 2 through "and fell late" on line 3 (the
// two marks above), settings at their defaults, the numbered key.
//
// What happens: the quote becomes "> The tide[^1] that day." and the
// definition is written as
//     [^1]: rose early
//         > and fell late
// The selected words were one sentence of one paragraph. In the footnote
// they are a paragraph "rose early" and, under it, a quote "and fell late":
// a "> " line starts a quote even right under a paragraph line.
//
// What should happen: either the footnote holds the words without the
// quote's markers ("[^1]: rose early" / "    and fell late"), as it already
// does when the second line is the quote's lazy line (no "> " in front) or
// a list item's continuation line, or the press is refused with a notice.
// The tests accept both.
//
// Why: the "> " is the line's formatting, not the user's text. README,
// "Turn selected text into a footnote": "A selection that takes part of a
// line's formatting ... or some but not all of a quote's lines, refuses".
// Jason's ruling Q33 (2026-10-09, test/hunt/spec-some-quote-lines-selected)
// named the same outcome as the fault for whole lines: "their "> " markers
// go into the footnote ... so the footnote draws a quote box the user's
// text was not in". That ruling's check (someWholeQuoteLines) only looks at
// selections that start at or before a line's marker, so one that starts
// in the text falls through. docs/obsidian-reading-rules.md E2 records a
// "    > ..." line inside a definition drawing a quote (`c6:z20-*`).
//
// Cause: src/commands/selection-footnote.ts, rangeText (line 989) joins the
// raw lines, markers and all, and indentDefinitionBody (line 1016) indents
// them as they are. The result gate passes it because the lines left
// behind read as before.
//
// Found by the Fable 5.2 review (2026-11-11); Jason chose to fix it.

beforeEach(resetNotices);

/** Selects from `from` to `to`, presses the numbered key, and returns the note after and the notices. */
async function convert(lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) {
    const doc = fakeEditor([...lines], { cursor: to, selection: { anchor: from, head: to }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, doc));
    return { after: doc.lines, notices: messages() };
}

/** True when the press was refused with a notice, or the new footnote's lines hold no quote. */
function refusedOrPlain(before: string[], after: string[], notices: string[]): boolean {
    if (after.join("\n") === before.join("\n")) return notices.length > 0;
    const reading = readNote(after);
    const made = reading.definitions.find((definition) => definition.name === "1");
    if (!made) return false;
    for (let line = made.start; line <= made.end; line++) {
        if ((reading.lineBlocks[line] ?? "").includes("blockquote")) return false;
    }
    return true;
}

describe("a selection over two lines of a quote's paragraph", () => {
    it("does not carry the second line's quote marker into the footnote", async () => {
        const before = ["Intro.", "", "> The tide rose early", "> and fell late that day.", "", "After."];
        const { after, notices } = await convert(before, { line: 2, ch: 11 }, { line: 3, ch: 15 });
        // Before the fix: "[^1]: rose early" / "    > and fell late", a quote inside the footnote.
        expect(refusedOrPlain(before, after, notices), after.join("\n")).toBe(true);
        // The fix converts, with the words alone, as a quote's lazy line already did.
        expect(after).toEqual(["Intro.", "", "> The tide[^1] that day.", "", "After.", "", "[^1]: rose early", "    and fell late"]);
    });

    it("the same in a quote inside a quote", async () => {
        const before = ["> > The tide rose early", "> > and fell late.", "", "After."];
        const { after } = await convert(before, { line: 0, ch: 13 }, { line: 1, ch: 17 });
        expect(after).toEqual(["> > The tide[^1]", "", "After.", "", "[^1]: rose early", "    and fell late."]);
    });

    it("the same in a callout's body", async () => {
        const before = ["> [!note] Title", "> The tide rose early", "> and fell late that day.", "", "After."];
        const { after, notices } = await convert(before, { line: 1, ch: 11 }, { line: 2, ch: 15 });
        expect(refusedOrPlain(before, after, notices), after.join("\n")).toBe(true);
    });

    it("the same when the selection ends the quote's last line", async () => {
        const before = ["> The tide rose early", "> and fell late.", "", "After."];
        const { after, notices } = await convert(before, { line: 0, ch: 11 }, { line: 1, ch: 16 });
        expect(refusedOrPlain(before, after, notices), after.join("\n")).toBe(true);
    });

    // A drag from the left margin of a quote's SECOND line. On a quote's
    // first line the same drag is refused (Jason's ruling B3, 2026-10-08,
    // test/hunt/spec-selection-from-margin-takes-marker); here the line left
    // behind is the quote's lazy line, so the gate passes it, and the
    // footnote's text is the quote "> and fell".
    it("a drag from the margin of a quote's second line does not put a quote in the footnote", async () => {
        const before = ["> The tide rose early", "> and fell late that day.", "", "After."];
        const { after, notices } = await convert(before, { line: 1, ch: 0 }, { line: 1, ch: 10 });
        // Before the fix: "[^1] late that day." and "[^1]: > and fell".
        expect(refusedOrPlain(before, after, notices), after.join("\n")).toBe(true);
        // The fix refuses, as ruling B3 does on a quote's first line.
        expect(notices).toEqual(["No footnote was created: it would break the line's formatting. Select the whole line, or only its text."]);
    });

    // Characterization: the shapes that already come out plain.
    it("a quote's lazy second line comes out plain (as it is today)", async () => {
        const before = ["> The tide rose early", "and fell late that day.", "", "After."];
        const { after } = await convert(before, { line: 0, ch: 11 }, { line: 1, ch: 13 });
        expect(after).toEqual(["> The tide[^1] that day.", "", "After.", "", "[^1]: rose early", "    and fell late"]);
    });
});
