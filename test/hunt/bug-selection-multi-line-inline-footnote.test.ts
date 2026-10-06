import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { NestedFootnoteNotice } from "../../src/editor/notice";
import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// BUG (wrong output): turning a selection into a footnote tears an inline
// footnote that runs over a line break, or nests a new one inside it.
//
// What the user would see: the note has "text ^[an inline" on one line
// and "note here] after" on the next, which Obsidian reads as one inline
// footnote (an inline footnote is "^[...]", its text written in place).
// The user selects text that cuts into it, or sits inside it, and
// presses a footnote key:
// - selecting "text ^[an" with the numbered key moves half of the inline
//   footnote into a new definition ("[^1] inline" / "note here] after",
//   and "[^1]: text ^[an" at the bottom), which destroys it;
// - selecting "note here] after" with the numbered key does the same
//   with its other half;
// - the inline key wraps the selection in a new "^[...]", escaping the
//   bracket it cuts, or writes "^[note]" inside the inline footnote: a
//   footnote nested in a footnote.
// The same selections on an inline footnote that fits on one line are
// refused with the nesting notice.
//
// Hunt 2026-10-05, round 2, lens press. Cluster P3.
//
// Source of truth: ADR 0001 and the nesting ruling (the plugin never
// creates a footnote inside a footnote); rule E3 in
// docs/obsidian-reading-rules.md and Obsidian's saved answers
// broad:20261004-726 (one inline footnote over two lines); Jason's
// decision of 2026-10-05 that a multi-line inline footnote behaves like a
// one-line one for the press (triage Q4); the one-line refusals.
//
// Cause: spanTouchesFootnote in src/commands/selection-footnote.ts asks
// reading.inlineNotesOn, which knows only inline footnotes on one line
// (2e58d86 left the selection conversions on it), so a selection that
// touches one over two lines is not seen as touching a footnote.
//
// Left out: the numbered key with "note" selected inside it already
// refuses, with the protected-selection notice rather than the nesting
// notice; only the wording differs, so it is not pinned.

const Settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
    expandSelectionToWholeWords: true,
};

const TwoLines = ["text ^[an inline", "note here] after"];

type At = [number, number];
async function convert(lines: string[], from: At, to: At, key: typeof insertAutonumFootnote) {
    const anchor = { line: from[0], ch: from[1] };
    const head = { line: to[0], ch: to[1] };
    const doc = fakeEditor([...lines], { selection: { anchor, head }, cursor: head, edits: true, wholeDoc: true, words: true });
    await key(fakePlugin(Settings, doc));
    return doc;
}

beforeEach(resetNotices);

describe.each([
    ["numbered key", insertAutonumFootnote],
    ["inline key", insertInlineFootnote],
] as const)("selection and an inline footnote over two lines, %s", (_name, key) => {
    it.fails("selecting 'text ^[an' (cuts its opening off) is refused and the note is unchanged", async () => {
        const doc = await convert(TwoLines, [0, 0], [0, 9], key);
        // Today (numbered): ["[^1] inline", "note here] after", "", "[^1]: text ^[an"]
        // Today (inline):   ["^[text ^\\[an] inline", "note here] after"]
        expect(doc.lines).toEqual(TwoLines);
        expect(messages()).toEqual([NestedFootnoteNotice]);
    });

    it.fails("selecting 'note here] after' (cuts its closing off) is refused and the note is unchanged", async () => {
        const doc = await convert(TwoLines, [1, 0], [1, 16], key);
        // Today (numbered): ["text ^[an inline", "[^1]", "", "[^1]: note here] after"]
        // Today (inline):   ["text ^[an inline", "^[note here\\] after]"]
        expect(doc.lines).toEqual(TwoLines);
        expect(messages()).toEqual([NestedFootnoteNotice]);
    });
});

describe("selection inside an inline footnote over two lines, inline key", () => {
    it.fails("selecting 'note' inside it is refused with the nesting notice", async () => {
        const doc = await convert(TwoLines, [1, 0], [1, 4], insertInlineFootnote);
        // Today: ["text ^[an inline", "^[note] here] after"], a nested inline footnote.
        expect(doc.lines).toEqual(TwoLines);
        expect(messages()).toEqual([NestedFootnoteNotice]);
    });
});
