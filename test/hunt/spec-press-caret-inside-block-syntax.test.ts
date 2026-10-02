import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { ProtectedCreationNotice } from "../../src/editor/insertion-liveness";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { noticed, resetNotices } from "../helpers/notices";

// spec question: when the caret sits in front of, or inside, a list
// marker or a heading's hashes, should the press refuse (as rulings 4 and
// 5 do for a quote marker and a setext underline), or land the reference
// after the marker?
//
// What it does now: the press writes the reference where the caret is,
// even with Insert at end of word on, and the construct dissolves.
// "[^1]- item" is a paragraph, not a bullet. "[^1]# Heading" and
// "#[^1]# Heading" are not headings. "> [^1]- quoted item" drops the
// bullet out of its quoted list, and "[^1]- > quoted in a list item"
// loses both the item and the quote.
// What a user might expect: the press refuses with the protected-text
// toast, as it does in front of a quote marker, or the reference lands
// after the marker's first word, where Insert at end of word would put it
// on an ordinary line.
// Why it is a question and not a bug: Jason's rulings 4 and 5 (2026-09-20,
// commit f098798) name only the quote marker and the setext underline. The
// same harm follows a list marker or a heading marker, but whether the
// ruling's reasoning extends to them (refuse) or the end-of-word
// adjustment owns them (land after the marker) is his call. The other
// faces the hunt found - between the digit and the dot of "2. second",
// inside a task checkbox "- [ ] task", on a thematic break "---" - are the
// same question.
//
// Hunt 2026-10-02, round 3, lenses press and reg. Cluster R7.
//
// Source of truth: the rulings (test/press-guards-quote-and-underline.test.ts
// states the harm) and CommonMark: a list marker or heading marker only
// counts at the start of its line, so text written in front of it, or
// between its characters, ends the construct.

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

describe("spec question: a caret in front of a list or heading marker", () => {
    beforeEach(resetNotices);

    for (const [line, ch, markerEnd] of [
        ["- item", 0, 2],
        ["# Heading", 0, 2],
        ["> - quoted item", 2, 4],
    ] as [string, number, number][]) {
        it.fails(`does not write the reference in front of the marker of ${JSON.stringify(line)} (ch ${ch})`, async () => {
            const doc = await press([line], 0, ch);
            const at = doc.lines[0].indexOf("[^1]");
            // either refused (line untouched) or landed after the marker and its space
            expect(at === -1 || at >= markerEnd).toBe(true);
        });
    }

    it.fails("refuses with the caret at ch 0 of \"- > quoted in a list item\", in front of the list marker", async () => {
        const lines = ["- > quoted in a list item"];
        const doc = await press(lines, 0, 0);
        // Today: "[^1]- > quoted in a list item".
        expect(doc.lines).toEqual(lines);
        expect(noticed(ProtectedCreationNotice)).toBe(true);
    });
});

describe("spec question: a caret inside a heading's hashes", () => {
    beforeEach(resetNotices);

    it.fails("between the hashes of '## Heading' (ch 1) the heading stays a heading", async () => {
        const doc = await press(["## Heading", "", "More."], 0, 1, { ...DEFAULT_SETTINGS, enablePopupEditor: false });
        // Today: "#[^1]# Heading".
        expect(doc.lines[0].startsWith("## ")).toBe(true);
    });
});
