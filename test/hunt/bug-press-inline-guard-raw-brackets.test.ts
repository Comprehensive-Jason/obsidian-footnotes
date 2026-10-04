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
// Cause: maskedInlineFootnoteSpan in src/commands/inline-footnotes.ts ran
// a cheap check on the RAW line first and gave up when that found no
// inline footnote at the caret. On the raw line the bracket inside the
// code paired up wrongly, so the cheap check said "not inside". Fixed in
// step 2 of the runtime swap (2026-10-03): the guards ask the note
// reading, which matches the brackets the way Obsidian does.

const OpenBracketInCode = "x ^[press the `[` key] y";
const CloseBracketInCode = "x ^[a `]` b] y";

beforeEach(resetNotices);

describe("the exit guard agrees with the masked scanner", () => {
    it("hops out of '^[press the `[` key]' from inside 'key'", () => {
        const ch = OpenBracketInCode.indexOf("key") + 1;
        const doc = fakeEditor([OpenBracketInCode], { cursor: { line: 0, ch } });
        // Before the fix: false, the guard did not see the inline footnote
        expect(exitInlineFootnoteIfInside(doc, null)).toBe(true);
        expect(doc.moves).toEqual([{ line: 0, ch: OpenBracketInCode.indexOf("] y") + 1 }]);
    });

    it("hops out of '^[a `]` b]' from inside 'b'", () => {
        const ch = CloseBracketInCode.indexOf("b]");
        const doc = fakeEditor([CloseBracketInCode], { cursor: { line: 0, ch } });
        expect(exitInlineFootnoteIfInside(doc, null)).toBe(true);
    });

    it("cell path: hops out of '^[the `[` key]' inside a table cell", () => {
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
        expect(exitInlineFootnoteIfInside({} as never, cell)).toBe(true);
    });

    // Corrected in step 2 of the runtime swap (2026-10-03): Obsidian's
    // parser matches an inline footnote's brackets before it reads math, so
    // the "[" inside "$[0,1)$" is counted, the "^[" never closes, and the
    // line holds no inline footnote at all: "^[holds on", the math, and
    // "only]" are plain text, and a caret in "only" has nothing to hop out
    // of. A bracket inside a code span is different: the brackets are
    // matched around code spans, as the tests above show. (A Reading-view
    // look would confirm the math case, for Jason.)
    it("'^[holds on $[0,1)$ only]' is no inline footnote, so a caret in 'only' has nothing to hop out of", () => {
        const line = "x ^[holds on $[0,1)$ only] y";
        const ch = line.indexOf("only") + 1;
        const doc = fakeEditor([line], { cursor: { line: 0, ch } });
        expect(exitInlineFootnoteIfInside(doc, null)).toBe(false);
    });
});

describe("a press inside such an inline footnote", () => {
    it("a numbered press inside 'key' of '^[press the `[` key]' does not nest a reference", async () => {
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
        // Before the fix: line 0 read "x ^[press the `[` k[^1]ey] y"
        expect(doc.lines[0]).toBe(OpenBracketInCode);
    });

    it("the inline key hops out (caret after the closing bracket), no edit, no toast", async () => {
        const ch = OpenBracketInCode.indexOf("key") + 1;
        const doc = fakeEditor([OpenBracketInCode], { cursor: { line: 0, ch }, edits: true, wholeDoc: true });
        await insertInlineFootnote(fakePlugin({ insertAtEndOfWord: false, lintOnFootnoteCreation: false }, doc));
        // Before the fix: the caret stayed at ch 19 and the protected-text toast showed
        expect({ line: doc.lines[0], cursor: doc.cursor, messages: messages() }).toEqual({
            line: OpenBracketInCode,
            cursor: { line: 0, ch: OpenBracketInCode.indexOf("] y") + 1 },
            messages: [],
        });
    });
});
