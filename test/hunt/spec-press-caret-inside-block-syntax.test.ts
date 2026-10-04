import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { BlockSyntaxNotice } from "../../src/editor/notice";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";

// Ruled (Jason, 2026-10-03): a press never writes into block syntax. With
// the caret in front of or inside a list marker (between an ordered
// marker's digit and its "." or ")" too), in front of or between a
// heading's "#" marks, inside a task box "[ ]" or "[x]", or anywhere on a
// thematic break ("---", "***", "___"), the press refuses with its own
// notice (BlockSyntaxNotice: "a footnote here would break the line's
// formatting"), the same rule that now covers the quote marker and the
// setext underline of rulings 4 and 5 (2026-09-20, commit f098798).
// test/press-guards-quote-and-underline.test.ts holds the full set.
//
// What the press did before the ruling: it wrote the reference where the
// caret was, even with Insert at end of word on, and the construct
// dissolved. "[^1]- item" is a paragraph, not a bullet. "[^1]# Heading"
// and "#[^1]# Heading" are not headings. "> [^1]- quoted item" drops the
// bullet out of its quoted list, and "[^1]- > quoted in a list item"
// loses both the item and the quote.
//
// Hunt 2026-10-02, round 3, lenses press and reg. Cluster R7.
//
// Source of truth: the ruling, and CommonMark: a list marker or heading
// marker only counts at the start of its line, so text written in front
// of it, or between its characters, ends the construct.

// The settings of the reg lens: insert at end of word on, everything else
// that could move text afterwards off.
const settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

/** Press the numbered key with the caret at line, ch of `lines`, under `s`, and hand back the editor. */
async function press(lines: string[], line: number, ch: number, s: object = settings) {
    const doc = fakeEditor([...lines], { cursor: { line, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(s, doc));
    return doc;
}

describe("ruled: a caret in front of a list or heading marker refuses", () => {
    beforeEach(resetNotices);

    for (const [line, ch] of [
        ["- item", 0],
        ["# Heading", 0],
        ["> - quoted item", 2],
        ["- > quoted in a list item", 0],
    ] as [string, number][]) {
        it(`refuses with the caret at ch ${ch} of ${JSON.stringify(line)}`, async () => {
            const doc = await press([line], 0, ch);
            expect(doc.lines).toEqual([line]);
            expect(noticed(BlockSyntaxNotice)).toBe(true);
        });
    }
});

describe("ruled: a caret inside block syntax refuses", () => {
    beforeEach(resetNotices);

    it("between the hashes of '## Heading' (ch 1) the heading stays a heading", async () => {
        const doc = await press(["## Heading", "", "More."], 0, 1, { ...DEFAULT_SETTINGS, enablePopupEditor: false });
        expect(doc.lines[0]).toBe("## Heading");
        expect(noticed(BlockSyntaxNotice)).toBe(true);
    });

    for (const [lines, line, ch] of [
        [["1. first", "2. second"], 1, 1],
        [["- [ ] task"], 0, 3],
        [["Prose.", "", "---", "", "More prose."], 2, 1],
    ] as [string[], number, number][]) {
        it(`refuses with the caret at ch ${ch} of ${JSON.stringify(lines[line])}`, async () => {
            const doc = await press(lines, line, ch);
            expect(doc.lines).toEqual(lines);
            expect(noticed(BlockSyntaxNotice)).toBe(true);
        });
    }
});
