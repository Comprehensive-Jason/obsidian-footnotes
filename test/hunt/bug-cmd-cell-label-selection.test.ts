// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 1 of 1 tests were red there and carry it.fails.
import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { selectionPressHandled } from "../../src/commands/selection-footnote";
import { TableCellEditor } from "../../src/editor/table-cursor";
import { noticed, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { NestedFootnoteNotice } from "../helpers/toasts";

// A table cell whose text is "[^1]: x" holds a LIVE reference: a footnote
// definition is a block construct and cannot exist inside a table cell's
// inline content, so Obsidian renders the "[^1]" as a footnote reference
// followed by a literal colon. Selecting that "[^1]" inside the cell and
// pressing the numbered key must refuse with NestedFootnoteNotice, like any
// selection touching a live footnote. But the cell branch of the selection
// claim calls spanTouchesFootnote, whose referenceOccurrences call omits the
// definition-start flag, so the column-0 label exclusion swallows the cell's
// reference: the press CONVERTS it, moving the live "[^1]" into the new
// footnote's definition body ("[^2]: [^1]", a nested footnote, forbidden
// plugin-wide since 2026-08-24). A single-caret press on that same "[^1]"
// navigates to the definition instead, because it is judged against the
// whole ROW line ("| [^1]: x |"), where the "[^1]" is not at column 0 and
// the label exclusion never fires. The selection claim judges the cell's own
// text, where it IS at column 0. The main-editor twin (a selection over a
// lazy label line's reference) is pinned in bug-cmd-lazy-label-selection.

interface DispatchSpec {
    changes?: { from: number; to?: number; insert: string };
    selection?: { anchor: number };
}

function fakeCell(text: string, anchor: number, head: number) {
    const dispatched: DispatchSpec[] = [];
    const cell: TableCellEditor = {
        state: {
            doc: { toString: () => text },
            selection: { main: { anchor, head } },
        },
        dispatch(spec: DispatchSpec) {
            dispatched.push(spec);
        },
    };
    return { cell, dispatched };
}

describe("a cell selection over a label-shaped cell text's live reference", () => {
    it("refuses with the nested-footnote notice instead of converting", () => {
        const lines = ["| H |", "| --- |", "| [^1]: x |", "", "[^1]: body"];
        const doc = fakeEditor(lines, {
            cursor: { line: 2, ch: 2 },
            edits: true,
            wholeDoc: true,
        });
        const { cell, dispatched } = fakeCell("[^1]: x", 0, 4);
        const plugin: FootnotePlugin = sharedFakePlugin(
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
        resetNotices();
        selectionPressHandled(plugin, doc, cell, "autonum", { line: 2, ch: 2 });
        expect(noticed(NestedFootnoteNotice)).toBe(true);
        expect(dispatched).toEqual([]);
        expect(doc.lines.join("\n")).toBe(lines.join("\n"));
    });
});
