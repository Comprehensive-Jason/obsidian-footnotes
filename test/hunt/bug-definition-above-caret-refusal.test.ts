import { EditorPosition } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";

import { noticeCalls } from "../mocks/obsidian";
import { resetNotices } from "../helpers/notices";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { ProtectedCreationNotice } from "../helpers/toasts";

// BUG (found by the entry corpus, 2026-08-12): when the note's last
// definition block sits ABOVE the caret (definitions under a mid-document
// heading, prose after them), the new definition is inserted above the
// caret line - shifting every later line down. The simulate-verify then
// read the reference's ORIGINAL line index off the SIMULATED document,
// found no reference there, and refused a perfectly legitimate creation
// with the protected-text toast. Selection conversion (issue #35)
// mirrored the same arithmetic and refused identically. The popup path's
// after-reference cursor shared the stale index too (it landed one line
// up); that half is popup territory, exercised by the smoke suite.
// Hunt: 2026-08-12. Lens: offsets. Severity: wrong-output (false refusal).

function fakeEditor(
    lines: string[],
    cursor: EditorPosition,
    selection?: { anchor: EditorPosition; head: EditorPosition },
): FakeEditor {
    return sharedFakeEditor(lines, {
        cursor,
        selection,
        edits: true,
        wholeDoc: true,
    });
}

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

beforeEach(() => {
    resetNotices();
});

describe("bug: a definition block above the caret falsely refused creation", () => {
    it("autonum inserts below mid-document definitions", async () => {
        const doc = fakeEditor(["[^1]: def", "", "prose target here"], {
            line: 2,
            ch: 5,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticeCalls.map((args) => args[0])).not.toContain(
            ProtectedCreationNotice,
        );
        expect(doc.lines).toEqual([
            "[^1]: def",
            "[^2]: ",
            "",
            "prose[^2] target here",
        ]);
        // the jump lands at the new definition's label end
        expect(doc.cursor).toEqual({ line: 1, ch: 6 });
    });

    it("selection conversion works below mid-document definitions", async () => {
        const doc = fakeEditor(
            ["[^1]: def", "", "prose target here"],
            { line: 2, ch: 6 },
            { anchor: { line: 2, ch: 6 }, head: { line: 2, ch: 12 } },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticeCalls.map((args) => args[0])).not.toContain(
            ProtectedCreationNotice,
        );
        expect(doc.lines).toEqual([
            "[^1]: def",
            "[^2]: target",
            "",
            "prose[^2] here",
        ]);
    });

    it("a deep stack of definitions above shifts by more than one line", async () => {
        // the section-heading slot path inserts TWO lines above the caret
        const doc = fakeEditor(
            ["[^a]: one", "[^b]: two", "", "tail prose here"],
            { line: 3, ch: 4 },
        );
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticeCalls.map((args) => args[0])).not.toContain(
            ProtectedCreationNotice,
        );
        expect(doc.lines).toEqual([
            "[^a]: one",
            "[^b]: two",
            "[^1]: ",
            "",
            "tail[^1] prose here",
        ]);
    });
});
