import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { SelectionFormattingNotice } from "../../src/commands/selection-footnote";

// spec question: a selection runs from the end of one paragraph into the
// next block and ends inside that block's own formatting ("# ", "> ",
// "3. ", or a callout's "> [!note]" title). Should the numbered key refuse
// it, as it refuses the same selection on one line?
//
// What it did before the ruling: "Para one here", a blank line, "# Heading text".
// Dragging from "here" to just after "# Hea" and pressing the numbered key
// gives "Para one[^1]ding text": the heading is gone from the page, its
// leftover text "ding text" has joined the paragraph, and footnote 1 holds
// "here" and then "# Hea", drawn as a heading inside the footnote. The
// same happens with a quote ("> Quoted" taken, "text here" left), a
// numbered item ("3. th" taken), and a callout's title ("> [!note] Ti"
// taken). In the callout case the body line "> Callout body text", which
// the selection never touched, stops being a callout and reads as a plain
// quote, because "> [!note]" on the first line is what makes a quote a
// callout (docs/obsidian-reading-rules.md A1).
// What a user might expect: the press refused with the notice the one-line
// shape gives, "No footnote was created: the selection takes part of the
// line's formatting. Select the whole line, or only its text."
//
// Options:
// (a) Refuse, as Jason's ruling B3 does for the same selection on one line
//     (recommended). Fixing cluster Z5's comparison in the result gate's
//     check 5 likely does this too, since both come from the same place.
//     The "result gate" is the one check every edit passes before it is
//     written: the note after must read the same as the note before,
//     except for what the edit meant to change.
// (b) Convert as now.
//
// Why it is a question and not a bug: ruling B3 (2026-10-08, the gate-s3
// and gate-s45 reports' "What a user sees change" tables) was made for a
// selection on one line that takes a line's formatting and leaves the rest
// of the line behind. Whether it covers a selection that starts in an
// earlier block is Jason's call.
//
// The tests assert option (a): the note is unchanged.
//
// Hunt 2026-10-08, cycle 6. Cluster Z6, triage question Q25.
//
// Answered (Jason's ruling Q25, 2026-10-08), option (a), extended: a
// selection that leaves the next block without its marker is refused with
// the selection's formatting notice, both when it ends inside the marker
// and when it takes the marker and part of the block's text. A selection
// of whole blocks still converts. The tests below were it.fails until
// then; what the press did before is described above.
//
// Origin: pre-existing.

const settings = {
    insertAtEndOfWord: false,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
    expandSelectionToWholeWords: false,
};

/** Selects from `anchor` to `head`, presses the numbered key, and gives back the note's lines. */
async function pressOver(lines: string[], anchor: EditorPosition, head: EditorPosition): Promise<string[]> {
    const doc = fakeEditor([...lines], { wholeDoc: true, edits: true, cursor: head, selection: { anchor, head } });
    await insertAutonumFootnote(fakePlugin(settings, doc));
    return doc.lines;
}

beforeEach(resetNotices);

describe("a selection from one paragraph that ends inside the next block's formatting", () => {
    // Refused since the fix for cluster Z5 (2026-10-08, the c6fix-A run):
    // the gate compares what is left of the selection's last line, and the
    // heading's leftover "ding text" would read as prose.
    it("ending inside a heading's '# ' refuses", async () => {
        const lines = ["Para one here", "", "# Heading text"];
        expect(await pressOver(lines, { line: 0, ch: 9 }, { line: 2, ch: 5 })).toEqual(lines);
        expect(noticed(SelectionFormattingNotice)).toBe(true);
    });

    // Before the ruling, in order: "Para one[^1] text here",
    // "Para one[^1]ird item text", and "Intro text[^1] end", with the taken
    // "> Quoted", "3. th", or "- listed" drawn as a quote or a list in
    // footnote 1.
    it.each<[string, string[], EditorPosition, EditorPosition]>([
        ["ending inside a quote's '> '", ["Para one here", "", "> Quoted text here"], { line: 0, ch: 9 }, { line: 2, ch: 8 }],
        ["ending inside a numbered item's '3. '", ["Para one here", "", "3. third item text"], { line: 0, ch: 9 }, { line: 2, ch: 5 }],
        ["taking a list item's '- ' and part of its text", ["Intro text here", "", "- listed end"], { line: 0, ch: 11 }, { line: 2, ch: 8 }],
        ["taking a quote's second line's '> ' and part of its text", ["Para one here", "", "> Quoted text", "> more quoted"], { line: 0, ch: 9 }, { line: 3, ch: 6 }],
        ["taking the next list item's '- ' and part of its text", ["- first item here", "- second item"], { line: 0, ch: 13 }, { line: 1, ch: 8 }],
    ])("a selection %s refuses", async (_what, lines, anchor, head) => {
        expect(await pressOver(lines, anchor, head)).toEqual(lines);
        expect(noticed(SelectionFormattingNotice)).toBe(true);
    });

    // Before the ruling: "Para one[^1]tle", then "> Callout body text" as a
    // plain quote, and footnote 1 held "here" and "> [!note] Ti".
    it("ending inside a callout's title refuses, so the body line below stays a callout", async () => {
        const lines = ["Para one here", "", "> [!note] Title", "> Callout body text"];
        expect(await pressOver(lines, { line: 0, ch: 9 }, { line: 2, ch: 12 })).toEqual(lines);
        expect(noticed(SelectionFormattingNotice)).toBe(true);
    });

    it("control: a selection of whole blocks still converts", async () => {
        const out = await pressOver(["Intro text here", "", "- listed end", "", "after"], { line: 0, ch: 11 }, { line: 2, ch: 12 });
        expect(out.slice(0, 3)).toEqual(["Intro text[^1]", "", "after"]);
    });

    it("control: a selection across two lines of one quote still converts", async () => {
        const out = await pressOver(["> Quoted text here", "> more quoted"], { line: 0, ch: 14 }, { line: 1, ch: 6 });
        expect(out[0]).toBe("> Quoted text[^1] quoted");
    });

    it("control (ruling B3's own shape, on one line): taking '# Heading' out of '# Heading here' refuses", async () => {
        const lines = ["Intro.", "", "# Heading here"];
        expect(await pressOver(lines, { line: 2, ch: 0 }, { line: 2, ch: 9 })).toEqual(lines);
    });
});
