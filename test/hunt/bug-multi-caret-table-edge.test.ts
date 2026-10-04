// Imported from the Kimi K3 cycle 1 hunt of 2026-09-16 (OpenCode worktree); 3 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { noticeCalls } from "../mocks/obsidian";
import { resetNotices } from "../helpers/notices";

// The single-caret press refuses to create a footnote at the edge of a
// table row (before the first pipe, after the last pipe, or on the
// delimiter row): a reference written there either lands in a cell the
// header does not have (which Obsidian drops, orphaning the footnote on
// arrival) or breaks the table's shape (press-guards.ts,
// warnTableEdgeCaretIfOutside). The multi-caret press promises atomicity:
// "one bad caret refuses the lot". But its guard sweep
// (multiCaretTargets in multi-caret.ts) runs only the protected-text and
// definition-interior guards - the table-edge guard is never run - so a
// second caret sitting at a table edge does not refuse, and the same
// reference is written right into the table's edge at that caret.
//
// What the user sees: they Alt-clicked into prose and accidentally onto
// the dashes under a table's header (or just past a row's closing pipe),
// pressed the numbered hotkey, and the table silently broke - exactly
// the outcome the single-caret press refuses with an explanation.
//
// Source of truth: the plugin's own table-edge rule (press-guards.ts:
// "A reference written past the closing pipe is a cell beyond the header
// count, which Obsidian drops, so the footnote never renders and its
// definition is orphaned on arrival; one written before the opening pipe
// pushes the last cell out of the table; one written into the dashes
// ends the table") plus the multi-caret atomicity contract
// (CONTEXT.md: "Atomic: one bad caret refuses the lot, one undo reverts
// the lot") and the manual multiple-cursors tests.
//
// Settings involved: none (multi-caret is always on).

function fakePlugin(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
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

const TABLE = ["| a | b |", "| --- | --- |", "| c | d |", "", "plain text"];

describe("a multi-caret press with one caret at a table edge", () => {
    it("refuses the whole press when a caret sits on the delimiter row", async () => {
        const doc = sharedFakeEditor(TABLE, {
            carets: [
                { line: 4, ch: 3 },
                { line: 1, ch: 3 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        // the single-caret press on the delimiter row refuses with a
        // toast; the multi-caret press must refuse the lot
        expect(doc.lines.join("\n")).toBe(TABLE.join("\n"));
    });

    it("refuses the whole press when a caret sits past the row's closing pipe", async () => {
        const doc = sharedFakeEditor(TABLE, {
            carets: [
                { line: 4, ch: 3 },
                { line: 2, ch: "| c | d |".length },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines.join("\n")).toBe(TABLE.join("\n"));
    });

    it("refuses the whole press when a caret sits before the row's opening pipe", async () => {
        const doc = sharedFakeEditor(TABLE, {
            carets: [
                { line: 4, ch: 3 },
                { line: 2, ch: 0 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines.join("\n")).toBe(TABLE.join("\n"));
    });

    it("control: both carets inside real cells insert fine (the table guard is cell-aware)", async () => {
        resetNotices();
        const doc = sharedFakeEditor(TABLE, {
            carets: [
                { line: 2, ch: 3 },
                { line: 2, ch: 8 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        // not refused: one shared footnote landed (the table guard never
        // fired, and the reference went into both cells)
        expect(doc.lines[2]).toContain("[^1]");
        void noticeCalls;
    });
});
