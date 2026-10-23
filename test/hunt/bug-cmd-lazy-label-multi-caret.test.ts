// Imported from the KIMI sweep of 2026-09-13 (T3 Code worktree); 1 of 1 tests were red there and carry it.fails.
import { describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { resetNotices, noticed } from "../helpers/notices";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { MultiCaretNestedNotice } from "../helpers/toasts";

// A user Alt-clicks a second caret and presses the numbered key with one
// caret inside the "[^1]" of a LAZY label line (a label-shaped line right
// under a paragraph, which is not a definition start: its "[^1]" is a live
// reference, pinned in bug-lazy-label-reference-is-live). The multi-caret
// claim's caretArtifact calls referenceOccurrences WITHOUT the line's
// definition-start flag, so the column-0 label exclusion swallows the lazy
// line's reference and the caret reads as plain text: the same "[^2]" is
// inserted at every caret, and safeInsertionCh nudges the one inside the
// reference left of its "^", mangling the line into "[[^2]^1]: lazy body"
// with a "[^2]:" definition appended and no notice. The atomic rule ("a
// caret inside an existing footnote, while the other carets sit in plain
// text, refuses") is bypassed exactly where the flag is dropped. The
// single-caret twin of this hole is pinned in bug-cmd-lazy-label-caret.

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

describe("a multi-caret press with one caret inside a lazy label line's live reference", () => {
    it("refuses with the multi-caret notice instead of nesting the new reference inside it", async () => {
        const lines = ["prose", "[^1]: lazy body", "", "[^1]: real body"];
        const doc = sharedFakeEditor(lines, {
            carets: [
                { line: 0, ch: 0 },
                { line: 1, ch: 2 },
            ],
            edits: true,
            wholeDoc: true,
        });
        resetNotices();
        await insertAutonumFootnote(fakePlugin(doc));
        expect(noticed(MultiCaretNestedNotice)).toBe(true);
        expect(doc.lines.join("\n")).toBe(lines.join("\n"));
    });
});
