// spec question Q33 (cluster V5): some but not all of a quote's lines are
// selected whole and the numbered key pressed. What should happen? (Q31's
// twin for quotes.)
//
// What it does now: "Intro." / "" / "> One." / "> Two." / "> Three." / ""
// / "After.". Selecting the first two lines whole is refused with "No
// footnote was created: the selection takes part of the line's formatting.
// Select the whole line, or only its text.", advice the user already
// followed. Selecting the last two gives "> One." / "[^1]" with "[^1]: >
// Two." / "    > Three." (live: the quote reads "One. [1]" and footnote 1
// holds a quote box "Two. Three."). A callout's body lines behave the same.
// Options: (a) refuse with Q31's kind of notice, "No footnote was created:
// select one line's text, or the whole quote."; (b) convert like Q27, the
// reference keeping "> ": "> [^1]" / "> Three." with "[^1]: One." / "
// Two." (live: one quote "[1] Three.", footnote "One. Two."); (c) leave it.
// This file asserts (a) or (b).
//
// Hunt 2026-10-09, cycle 8, lens presses and selections. Source: rulings
// Q25, Q27 (quote lines), and Q31.
// Origin: pre-existing (red at 34d5377 and 3a47f7a).

// SPEC QUESTION: some but not all of a
// quote's or a callout's lines, each whole, selected and converted.
//
// Ruling Q27 (for quote lines, 2026-10-08): one quote line selected whole
// keeps its "> " and moves only its text ("> One." gives "> [^1]" with
// "[^1]: One."). Ruling Q31: some but not all of a list's items, each
// whole, are refused with "select one item's text, or the whole list."
// Ruling Q25: whole blocks convert as whole blocks. Two or more whole lines
// of a longer quote fall between them, as two whole bullets did before Q31
// (cluster Y12), and get two different answers depending on where they sit:
//
// - the first two of three lines of a quote are refused with "Select the
//   whole line, or only its text." (SelectionFormattingNotice), advice the
//   user already followed, Y12's shape for quotes;
// - the last two of three lines convert, and their "> " markers go into
//   the footnote: "> One." / "[^1]" with "[^1]: > Two." / "    > Three.",
//   so the footnote draws a quote box the user's text was not in as a
//   footnote of its own, and the "[^1]" line has lost its "> " (it still
//   reads as more of the quote, by laziness);
// - every body line of a callout (its title not selected) converts the same
//   way: "> [!note] Title" / "[^1]" with the body as a quote in the footnote.
//
// The assertions are fix-shape-neutral: either the press is refused with
// advice the user has not already followed, or it converts the way Q27
// does, the "> " staying on the reference's line and out of the footnote.
import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { SelectionFormattingNotice } from "../../src/commands/selection-footnote";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

type Pos = { line: number; ch: number };
const settings = { ...DEFAULT_SETTINGS, enablePopupEditor: false };

async function select(lines: string[], anchor: Pos, head: Pos) {
    const doc = fakeEditor(lines, { cursor: head, selection: { anchor, head }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(settings, doc));
    return doc;
}

/** Refused with advice the user did not already follow, or converted keeping the quote markers on the reference's line and out of the footnote. */
function asQ27OrFollowableRefusal(before: string[], after: string[], refLine: number, prefix: string) {
    if (after.join("\n") === before.join("\n")) {
        expect(messages()).not.toContain(SelectionFormattingNotice);
        return;
    }
    expect(after[refLine].startsWith(prefix)).toBe(true);
    const definition = after.findIndex((line) => /^\[\^\d+\]: /.test(line));
    expect(after[definition]).not.toMatch(/^\[\^\d+\]: >/);
}

const QUOTE = ["Intro.", "", "> One.", "> Two.", "> Three.", "", "After."];

beforeEach(resetNotices);

describe("some but not all of a quote's lines, each whole", () => {
    it.fails("the first two of three: refused with advice the user can follow, or converted as Q27 does", async () => {
        const doc = await select(QUOTE, { line: 2, ch: 0 }, { line: 3, ch: 6 });
        asQ27OrFollowableRefusal(QUOTE, doc.lines, 2, "> ");
    });

    it.fails("the last two of three: the reference keeps its quote marker and the footnote holds no quote marker", async () => {
        const doc = await select(QUOTE, { line: 3, ch: 0 }, { line: 4, ch: 8 });
        asQ27OrFollowableRefusal(QUOTE, doc.lines, 3, "> ");
    });

    it.fails("every body line of a callout, its title not selected: the same", async () => {
        const lines = ["> [!note] Field notes", "> The tide rose at six.", "> Oysters closed.", "", "After."];
        const doc = await select(lines, { line: 1, ch: 0 }, { line: 2, ch: 17 });
        asQ27OrFollowableRefusal(lines, doc.lines, 1, "> ");
    });

    it("control: one quote line selected whole converts as Q27 rules", async () => {
        const doc = await select(QUOTE, { line: 3, ch: 0 }, { line: 3, ch: 6 });
        expect(doc.lines.slice(0, 5)).toEqual(["Intro.", "", "> One.", "> [^1]", "> Three."]);
        expect(doc.lines).toContain("[^1]: Two.");
    });

    it("control: the whole quote converts as whole blocks (Q25)", async () => {
        const doc = await select(QUOTE, { line: 2, ch: 0 }, { line: 4, ch: 8 });
        expect(doc.lines.slice(0, 5)).toEqual(["Intro.", "", "[^1]", "", "After."]);
    });
});
