import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (annoyance): with the Section heading setting on, a press on the
// blank line above a definition is refused with the catch-all notice
// instead of the notice that names the line's formatting.
//
// What the user would see: Section heading set to "# Footnotes" and turned
// on. The note is "See the note[^n] here.", a blank line, "[^n]: Smith
// 2020, p. 4.", with no heading line yet. The caret is on the blank line
// and they press the numbered key. The press is refused, rightly, and the
// note is unchanged, but the notice says "No footnote was created: it
// would change how Obsidian reads the text around it." With the setting
// off, and when the heading is already in the note, the same press says
// "No footnote was created: a footnote here would break the line's
// formatting. Move the caret into the text.", which tells the user what to
// do. Only the wording is wrong; nothing is written.
//
// A "definition" is the "[^n]: ..." line that holds a footnote's text. The
// "result gate" is the one check every edit passes before it is written:
// the note after must read the same as the note before, except for what
// the edit meant to change. Each refusal names a reason, and each reason
// has its own notice.
//
// Hunt 2026-10-08, cycle 7. Cluster Y2.
//
// Origin: green at 97abeac, this cycle's origin. A regression from
// c5a015a (2026-10-08), which tells the result gate that the section
// heading a press writes is text from outside the note.
//
// Source of truth: Jason's ruling B2 (runs/gate-s3.report.md, "What a user
// sees change", 2026-10-08): a press on an empty line above a definition
// is refused with the block-syntax notice. The saved answer
// gs3:b1-definition (docs/obsidian-reading-rules.md G1) is why it is
// refused at all: "[^1]" written straight above "[^n]: ..." makes the
// label lazy text of the paragraph, and footnote n loses its definition.
//
// Cause: the press would write "[^1]" on the blank line and, at the end of
// the note, the heading "# Footnotes" with the new definition under it.
// Since c5a015a the press declares the heading as text written in from
// outside the note. No unchanged line separates the press from the
// heading, so the gate's check 5, which compares how each line reads,
// treats the whole stretch as the user's own text and skips its formatting
// comparison there. Check 1, which checks that the footnotes the press did
// not touch read the same, then refuses with the reason "other", whose
// notice is the catch-all one.

const base = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "# Footnotes",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

/** Presses the numbered key with the caret at `line`, `ch`, under the base settings with `extra` on top, and returns the lines after. */
async function pressAt(lines: string[], line: number, ch: number, extra: Record<string, unknown>) {
    const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, words: true, cursor: { line, ch } });
    await insertAutonumFootnote(fakePlugin({ ...base, ...extra }, doc));
    return doc.lines;
}

beforeEach(resetNotices);

/** The block-syntax notice, which ruling B2 names for this refusal. */
const Formatting = "No footnote was created: a footnote here would break the line's formatting. Move the caret into the text.";
const headingOn = { enableFootnoteSectionHeading: true };

describe("ruling B2's refusal keeps its notice with the Section heading setting on", () => {
    const note = ["See the note[^n] here.", "", "[^n]: Smith 2020, p. 4."];

    it("control: Section heading off, the block-syntax notice", async () => {
        expect(await pressAt(note, 1, 0, {})).toEqual(note);
        expect(messages()).toEqual([Formatting]);
    });

    // Now: refused, the note unchanged, with "No footnote was created: it
    // would change how Obsidian reads the text around it."
    it("Section heading on, no heading in the note yet: the same refusal shows the block-syntax notice", async () => {
        expect(await pressAt(note, 1, 0, headingOn)).toEqual(note);
        expect(messages()).toEqual([Formatting]);
    });

    it("control: Section heading on, the definitions already under '# Footnotes': the block-syntax notice", async () => {
        const withHeading = ["See the note[^n] here.", "", "# Footnotes", "", "[^n]: Smith 2020, p. 4."];
        // the blank line above the definitions, under the heading
        expect(await pressAt(withHeading, 3, 0, headingOn)).toEqual(withHeading);
        expect(messages()).toEqual([Formatting]);
    });

    it("control: Section heading on, the blank line above a table: the same notice as with it off", async () => {
        const table = ["Some text.", "", "| a | b |", "| --- | --- |", "| c | d |"];
        await pressAt(table, 1, 0, {});
        const off = messages().slice();
        resetNotices();
        await pressAt(table, 1, 0, headingOn);
        expect(messages()).toEqual(off);
    });
});
