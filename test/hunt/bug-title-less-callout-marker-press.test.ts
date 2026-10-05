import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { BlockSyntaxNotice } from "../../src/editor/notice";

// BUG (wrong output): a press at the end of a callout's first line that
// has no title glues the footnote onto the callout marker, and the
// callout stops being one.
//
// What the user would see: a callout with no title, such as "> [!note]-"
// over "> body". With the caret at the end of the first line, a press
// writes "> [!note]-[^1]". Obsidian no longer sees a callout: the box
// turns into a plain quote that shows "[!note]-" as text. The same
// happens with "> [!tip]+", and the inline key does it to "> [!note]"
// and "> > [!note]" as well.
//
// The numbered and named keys on "> [!note]" and "> > [!note]" are
// already refused and the note is unchanged; those four tests fail only
// because the refusal shows the link notice instead of the block-syntax
// one.
//
// Hunt 2026-10-05, round 1, lens refusals. Cluster RF3.
//
// Source of truth: rule A1; Obsidian's callout regex
// /^\[!([^\]]+)\]([+\-]?)(?:\s|$)/ (Obsidian 1.14 app.js, used by both
// Reading view and the editor), which needs whitespace or the end of the
// line after the "]" and the optional fold sign; the block-syntax ruling
// of 2026-10-03 (a press never writes into block syntax). A caret inside
// the marker ("> [!note] Title" at ch 9) is already refused with the
// block-syntax notice.
//
// Cause: blockSyntaxEnd (the column where a line's block syntax ends and
// its text begins) equals the line's length here, so the block-syntax
// guard lets a caret at the end through.

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

describe("a press at the end of a title-less callout marker", () => {
    for (const first of ["> [!note]", "> [!note]-", "> [!tip]+", "> > [!note]"]) {
        for (const [name, fn] of [["numbered", insertAutonumFootnote], ["named", insertNamedFootnote], ["inline", insertInlineFootnote]] as [string, Press][]) {
            it.fails(`${name} key at the end of ${JSON.stringify(first)}`, async () => {
                const lines = [first, first.startsWith("> >") ? "> > body" : "> body"];
                const doc = fakeEditor([...lines], { cursor: { line: 0, ch: first.length }, edits: true, wholeDoc: true, words: true });
                await fn(fakePlugin(Settings, doc));
                // Today, for example: "> [!note]-[^1]".
                expect(doc.lines).toEqual(lines);
                expect(messages()).toEqual([BlockSyntaxNotice]);
            });
        }
    }
});
