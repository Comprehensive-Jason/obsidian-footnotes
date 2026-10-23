// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 2 of 2 tests were red there and carry it.fails.
import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { resetNotices, noticed } from "../helpers/notices";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { NestedFootnoteNotice } from "../helpers/toasts";

// A user selects the "[^1]" sitting on a LAZY label line (a label-shaped
// line directly under a paragraph: "prose" then "[^1]: lazy body" with no
// blank line between) and presses the numbered key. That "[^1]" is a LIVE
// reference (pinned in bug-lazy-label-reference-is-live: the line is not a
// definition start, so the grammar counts the "[^1]" as a reference), so
// the selection claim must refuse with NestedFootnoteNotice like any other
// selection touching a live footnote. Instead selectionTouchesFootnote
// calls referenceOccurrences WITHOUT the line's definition-start flag, the
// column-0 label exclusion swallows the lazy line's reference, and the
// press converts it: the live "[^1]" moves into the new footnote's
// definition body, a nested footnote the plugin-wide ruling (2026-08-24)
// says creation must never produce.

function fakePlugin(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            expandSelectionToWholeWords: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "",
            enableRemoveBlankLastLines: false,
            lintOnFootnoteCreation: false,
        },
        doc,
    );
}

describe("a selection covering a lazy label line's live reference", () => {
    it("refuses with the nested-footnote notice instead of converting", async () => {
        const lines = ["prose", "[^1]: lazy body", "", "[^1]: real body"];
        const doc = sharedFakeEditor(lines, {
            cursor: { line: 1, ch: 0 },
            selection: {
                anchor: { line: 1, ch: 0 },
                head: { line: 1, ch: 4 },
            },
            edits: true,
            wholeDoc: true,
        });
        resetNotices();
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(NestedFootnoteNotice)).toBe(true);
        expect(doc.lines.join("\n")).toBe(lines.join("\n"));
    });

    it("refuses when the selection covers only part of the lazy reference", async () => {
        const lines = ["prose", "[^1]: lazy body", "", "[^1]: real body"];
        const doc = sharedFakeEditor(lines, {
            cursor: { line: 1, ch: 1 },
            selection: {
                anchor: { line: 1, ch: 1 },
                head: { line: 1, ch: 3 },
            },
            edits: true,
            wholeDoc: true,
        });
        resetNotices();
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(NestedFootnoteNotice)).toBe(true);
        expect(doc.lines.join("\n")).toBe(lines.join("\n"));
    });
});
