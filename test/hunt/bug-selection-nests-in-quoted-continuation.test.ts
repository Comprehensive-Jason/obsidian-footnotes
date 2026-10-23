// Imported from the Kimi K3 cycle 3 hunt of 2026-09-16 (OpenCode worktree); 1 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { beforeEach, describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor as sharedFakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { noticeCalls } from "../mocks/obsidian";
import { resetNotices } from "../helpers/notices";
import { NestedFootnoteNotice } from "../helpers/toasts";

// A selection converted to a footnote refuses to nest when it sits inside
// another footnote's definition (ADR-0001; selection-footnote.ts checks
// the column-0 blocks, then every line's definition-start flag, then
// whether the selection itself touches a live footnote). A QUOTED
// definition's CONTINUATION line passes all three: quoted definitions
// form no blocks, the continuation carries no label of its own, and the
// reference it belongs to sits on the label line ABOVE the selection.
// Reading view folds such a line into the quoted footnote's body (pinned
// ground truth 2026-09-16: "> [^1]: quoted" then "> cont line" renders
// as one footnote), so the conversion plants the new reference inside the
// quoted footnote - a nested footnote, exactly what the claim exists to
// refuse.
//
// What the user sees: selecting words on the line under "> [^q]: body"
// and pressing the numbered key converts them, leaving "> c[^1] words"
// behind - a footnote reference inside another footnote's body, which the
// lint then alerts about on every pass.
//
// Source of truth: ADR-0001 (no nested footnotes, prevented plugin-wide;
// "A selection that contains or cuts through any live reference,
// placeholder, or inline footnote refuses to convert" - and a selection
// inside a definition's body is the same nesting), the second-review fix
// this file's neighbor records (2026-09-09: selecting the body of the
// quoted LABEL line was refused; the continuation line is the case that
// check misses), and the single-caret press on the same line, which the
// definition-jump step owns (navigation.ts quotedDefinitionAbove).
//
// Settings involved: defaults (the selection claim is always on).

function fakePlugin(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            lintOnFootnoteCreation: false,
        },
        doc,
    );
}

const DOC = ["text", "", "> [^q]: quoted body", "> continuation words"];

describe("a selection inside a quoted definition's continuation line", () => {
    beforeEach(() => {
        resetNotices();
    });

    it("refuses to convert (would nest a footnote in the quoted body)", async () => {
        const doc = sharedFakeEditor(DOC, {
            cursor: { line: 3, ch: 14 },
            selection: { anchor: { line: 3, ch: 3 }, head: { line: 3, ch: 14 } },
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines.join("\n")).toBe(DOC.join("\n"));
        expect(noticeCalls.some((call) => call[0] === NestedFootnoteNotice)).toBe(true);
    });

    it("control: a selection spanning the quoted LABEL line refuses (the definition-start flag catches it)", async () => {
        const doc = sharedFakeEditor(DOC, {
            cursor: { line: 3, ch: 8 },
            selection: { anchor: { line: 2, ch: 11 }, head: { line: 3, ch: 8 } },
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines.join("\n")).toBe(DOC.join("\n"));
    });

    it("control: a selection of plain quoted text (no definition above) converts fine", async () => {
        const lines = ["text", "", "> just a quote", "> more quote"];
        const doc = sharedFakeEditor(lines, {
            cursor: { line: 3, ch: 8 },
            selection: { anchor: { line: 3, ch: 3 }, head: { line: 3, ch: 8 } },
            edits: true,
            wholeDoc: true,
        });
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines.some((line) => line.includes("[^1]"))).toBe(true);
    });
});
