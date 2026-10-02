import { beforeEach, describe, expect, it } from "vitest";

import { exitInlineFootnoteIfInside } from "../../src/commands/inline-footnotes";
import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { TableCellEditor } from "../../src/editor/table-cursor";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (wrong output): a numbered press inside an inline footnote whose
// text holds a lone square bracket in code or math writes a reference
// inside the inline footnote.
//
// What the user would see: the line reads "x ^[press the `[` key] y". With
// the caret in "key", the numbered hotkey writes "^[press the `[`
// k[^1]ey]", a footnote nested inside a footnote, instead of hopping out
// past the closing "]". The inline hotkey in the same spot refuses with
// the wrong toast ("footnotes can't go inside code, math, or other
// protected text") and leaves the caret where it was. The same happens
// with a "]" in code ("^[a `]` b]") and with math holding a half-open
// interval ("^[holds on $[0,1)$ only]"), and inside a table cell.
//
// Hunt 2026-10-02, round 3, lens gram-off. Cluster G1.
//
// Source of truth: the plugin's own masked reading, in which a code span's
// or a math span's brackets do not open or close the inline footnote (the
// sanitizer escapes them on that assumption, round 2), and the guard's
// purpose: a numbered press inside an inline footnote hops out instead of
// nesting a reference (QOL 2026-07-18, ADR 0001: no nesting).
//
// Cause: maskedInlineFootnoteSpan in src/commands/inline-footnotes.ts runs
// a cheap check on the RAW line first and gives up when that finds no
// inline footnote at the caret. On the raw line the bracket inside the
// code or math pairs up wrongly, so the cheap check says "not inside" even
// though the masked line, where those brackets are blanked out, says
// "inside".

const OpenBracketInCode = "x ^[press the `[` key] y";
const CloseBracketInCode = "x ^[a `]` b] y";

beforeEach(resetNotices);

describe("the exit guard agrees with the masked scanner", () => {
    it.fails("hops out of '^[press the `[` key]' from inside 'key'", () => {
        const ch = OpenBracketInCode.indexOf("key") + 1;
        const doc = fakeEditor([OpenBracketInCode], { cursor: { line: 0, ch } });
        // Today: false, the guard does not see the inline footnote
        expect(exitInlineFootnoteIfInside(doc, null)).toBe(true);
        expect(doc.moves).toEqual([{ line: 0, ch: OpenBracketInCode.indexOf("] y") + 1 }]);
    });

    it.fails("hops out of '^[a `]` b]' from inside 'b'", () => {
        const ch = CloseBracketInCode.indexOf("b]");
        const doc = fakeEditor([CloseBracketInCode], { cursor: { line: 0, ch } });
        // Today: false
        expect(exitInlineFootnoteIfInside(doc, null)).toBe(true);
    });

    it.fails("cell path: hops out of '^[the `[` key]' inside a table cell", () => {
        const text = "a ^[the `[` key] b";
        const dispatches: unknown[] = [];
        const cell: TableCellEditor = {
            state: {
                doc: { toString: () => text },
                selection: { main: { head: text.indexOf("key") + 1, anchor: text.indexOf("key") + 1 } },
            },
            dispatch: (tr) => {
                dispatches.push(tr);
            },
        };
        // Today: false
        expect(exitInlineFootnoteIfInside({} as never, cell)).toBe(true);
    });

    it.fails("hops out of '^[holds on $[0,1)$ only]' from inside 'only'", () => {
        // "$[0,1)$" is math; on the raw line its "[" never closes
        const line = "x ^[holds on $[0,1)$ only] y";
        const ch = line.indexOf("only") + 1;
        const doc = fakeEditor([line], { cursor: { line: 0, ch } });
        // Today: false
        expect(exitInlineFootnoteIfInside(doc, null)).toBe(true);
    });
});

describe("a press inside such an inline footnote", () => {
    it.fails("a numbered press inside 'key' of '^[press the `[` key]' does not nest a reference", async () => {
        const ch = OpenBracketInCode.indexOf("key") + 1;
        const doc = fakeEditor([OpenBracketInCode], { cursor: { line: 0, ch }, edits: true, wholeDoc: true });
        await insertAutonumFootnote(
            fakePlugin(
                {
                    insertAtEndOfWord: false,
                    enablePopupEditor: false,
                    enableFootnotePrefix: false,
                    enableFootnoteSectionHeading: false,
                    footnoteSectionHeading: "",
                    enableRemoveBlankLastLines: true,
                    lintOnFootnoteCreation: false,
                },
                doc,
            ),
        );
        // Today: line 0 reads "x ^[press the `[` k[^1]ey] y"
        expect(doc.lines[0]).toBe(OpenBracketInCode);
    });

    it.fails("the inline key hops out (caret after the closing bracket), no edit, no toast", async () => {
        const ch = OpenBracketInCode.indexOf("key") + 1;
        const doc = fakeEditor([OpenBracketInCode], { cursor: { line: 0, ch }, edits: true, wholeDoc: true });
        await insertInlineFootnote(fakePlugin({ insertAtEndOfWord: false, lintOnFootnoteCreation: false }, doc));
        // Today: the caret stays at ch 19 and the protected-text toast shows
        expect({ line: doc.lines[0], cursor: doc.cursor, messages: messages() }).toEqual({
            line: OpenBracketInCode,
            cursor: { line: 0, ch: OpenBracketInCode.indexOf("] y") + 1 },
            messages: [],
        });
    });
});
