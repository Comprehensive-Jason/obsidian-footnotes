import { beforeEach, describe, expect, it } from "vitest";

import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// spec question: should a press on a link reference definition's line be
// refused?
//
// What it does now: a link reference definition is a line such as
// "[ref]: http://u" that gives "[x][ref]" links elsewhere in the note
// their address. With the caret inside the label "ref", a press steps
// over "]" and ":" and writes "[ref]:[^1] http://u"; with the caret at
// the end of the address it writes "[ref]: http://u[^1]". Either way the
// plugin's own reader then reads the line as a paragraph: the definition
// is gone, and every "[x][ref]" link in the note stops being a link.
// What a user might expect: the press refuses (with the block-syntax
// notice or the link notice), and the definition keeps working.
// Why it is a question and not a bug: the check that a new footnote is
// born live passes, since the new reference itself is live; it does not
// ask whether the line it sits on stopped being a definition. Whether
// Obsidian reads the edited line the same way is not yet checked live,
// and a footnote on a link definition's line is a rare thing to want.
//
// Hunt 2026-10-05, round 1, lens refusals. Cluster RF5.
//
// Source of truth: the block-syntax ruling of 2026-10-03 (a press never
// writes into block syntax); the plugin's reader, which reads the line
// as a link definition before the press and as a paragraph after it.

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

const Note = ["see [x][ref] now", "", "[ref]: http://u"];

/** Whether line 2 of `lines` still reads as a link reference definition (the reader blots its address). */
const definitionStands = (lines: string[]) =>
    readNote(lines).lineBlocks[2].includes("definition") && !readNote(lines).lineBlocks[2].includes("footnoteDefinition");

beforeEach(resetNotices);

describe("a press on a link reference definition's line", () => {
    for (const [name, fn, ch] of [
        ["numbered key in the label", insertAutonumFootnote, 3],
        ["numbered key at the end of the address", insertAutonumFootnote, 15],
        ["named key at the end of the address", insertNamedFootnote, 15],
    ] as [string, Press, number][]) {
        it.fails(`${name} keeps the definition standing`, async () => {
            const doc = fakeEditor([...Note], { cursor: { line: 2, ch }, edits: true, wholeDoc: true, words: true });
            await fn(fakePlugin(Settings, doc));
            // Today: the line reads as a paragraph after the press.
            expect(definitionStands(doc.lines)).toBe(true);
        });
    }
});
