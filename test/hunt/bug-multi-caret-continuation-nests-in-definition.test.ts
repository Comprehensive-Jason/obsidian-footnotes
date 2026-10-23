// Found by the multi-caret named-flow property in the 1500-run soak after Kimi hunt cycle 2 (2026-09-16); pinned red, then fixed the same day.
import { describe, expect, it, beforeEach } from "vitest";

import FootnotePlugin from "../../src/main";
import { insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { noticeCalls } from "../mocks/obsidian";
import { resetNotices } from "../helpers/notices";
import { MultiCaretNestedNotice } from "../helpers/toasts";

// The named multi-caret flow's second press: every caret sits on a
// "[^name]" reference with no definition, so the press collapses the
// carets to the first one in the note and creates the ONE shared
// definition (multiCaretContinuation in multi-caret.ts). Only the first
// caret is guarded there. A reference typed on the line right under a
// column-0 definition is that definition's lazy continuation (Reading
// view, 2026-09-16), so when the OTHER caret's reference lives inside a
// definition, the shared definition completes a nested footnote, which the
// plugin refuses to create everywhere (ADR 1) and which the single-caret
// press refuses through the same guard.
//
// What the user sees: two "[^]" placeholders, one of them planted on the
// blank line under a definition, get the name typed once; the second press
// creates "[^name]:" at the bottom instead of refusing with the nested
// footnote explanation, and the reference under the definition renders as
// a footnote inside a footnote.

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

// the second "[^a]" sits under "[^1]: alpha" with no blank line between,
// so it is the definition's lazy continuation
const DOC = ["text[^a] more", "", "[^1]: alpha", "[^a]"];

describe("the named multi-caret second press with one reference inside a definition", () => {
    beforeEach(() => {
        resetNotices();
    });

    it("refuses the whole press instead of nesting a footnote", async () => {
        const doc = sharedFakeEditor(DOC, {
            carets: [
                { line: 0, ch: 7 },
                { line: 3, ch: 3 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines.join("\n")).toBe(DOC.join("\n"));
    });

    it("explains with the nested-footnote message", async () => {
        const doc = sharedFakeEditor(DOC, {
            carets: [
                { line: 3, ch: 3 },
                { line: 0, ch: 7 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertNamedFootnote(fakePlugin(doc));
        expect(noticeCalls.some((call) => call[0] === MultiCaretNestedNotice)).toBe(true);
    });

    it("control: with a blank line between, both references are in prose and the shared definition is created", async () => {
        const lines = ["text[^a] more", "", "[^1]: alpha", "", "[^a]"];
        const doc = sharedFakeEditor(lines, {
            carets: [
                { line: 0, ch: 7 },
                { line: 4, ch: 3 },
            ],
            edits: true,
            wholeDoc: true,
        });
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines.filter((line) => line.startsWith("[^a]:"))).toHaveLength(1);
    });
});
