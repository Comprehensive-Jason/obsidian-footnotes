import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "obsidian";

import { noticed, resetNotices } from "./helpers/notices";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";

import type FootnotePlugin from "../src/main";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import { SelectionSpanNotice } from "../src/commands/selection-footnote";

// These tests take over the last two checks of the retired manual sheet
// ("Multiple cursors") that a machine can settle. Every other box on that
// sheet was already pinned, either by test/multi-caret.test.ts or by the
// smoke suite, so after these the sheet has nothing left to check by hand.
//
//  1. "With `Lint on footnote creation` and `Reindex` ON (popup off): the
//     NUMBERED press at several carets renumbers everything ... and lands
//     on the new empty definition; full parity with a single-caret press"
//     (test/multi-caret.test.ts already pins the renumbered TEXT; what was
//     missing is where the caret ends up)
//  2. "MIXED shape: drag-select a word, then Alt-click a second caret
//     elsewhere, press any footnote hotkey: the press REFUSES with the
//     one-continuous-stretch toast and nothing changes anywhere; the extra
//     caret is never silently dropped"

// Several Alt-clicked carets, the way the fake editor models them: a list
// of positions that stays fixed for the whole press, which is how Obsidian
// hands them over too.
function caretEditor(lines: string[], carets: EditorPosition[]): FakeEditor {
    return sharedFakeEditor(lines, {
        carets,
        edits: true,
        wholeDoc: true,
        words: true,
    });
}

function fakePlugin(
    doc: FakeEditor,
    overrides: Partial<FootnotePlugin["settings"]> = {},
): FootnotePlugin {
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
            ...overrides,
        },
        doc,
    );
}

beforeEach(() => {
    resetNotices();
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the creation lint after a multi-caret numbered press", () => {
    // The sheet's fixture, cut down to the lines that matter: the prose
    // line the carets sit on, and a line below it that keeps an older
    // numbered footnote alive so the reindex has something to renumber.
    const lines = [
        "alpha bravo charlie delta echo",
        "The fixture also keeps a numbered footnote alive[^5] for the lint check.",
        "",
        "[^5]: five",
    ];
    // after "alpha", after "charlie", after "echo"
    const carets: EditorPosition[] = [
        { line: 0, ch: 5 },
        { line: 0, ch: 19 },
        { line: 0, ch: 30 },
    ];

    it("renumbers the whole note and lands the caret on the new empty definition", async () => {
        const doc = caretEditor(lines, carets);
        await insertAutonumFootnote(
            fakePlugin(doc, {
                lintOnFootnoteCreation: true,
                lintReindex: true,
            }),
        );
        // the press minted the same new reference at all three carets with
        // ONE definition, then the creation lint renumbered the note. The
        // new references come FIRST in the note, so they take number 1 and
        // the older footnote becomes number 2.
        expect(doc.lines).toEqual([
            "alpha[^1] bravo charlie[^1] delta echo[^1]",
            "The fixture also keeps a numbered footnote alive[^2] for the lint check.",
            "",
            "[^1]: ",
            "[^2]: five",
        ]);
        // and the caret waits at the end of the new, still empty
        // definition, ready for typing
        expect(doc.cursor).toEqual({ line: 3, ch: "[^1]: ".length });
    });

    // The sheet's parenthetical says the numbering comes out the other way
    // round: "the fixture's [^5] becomes [^1], the new references [^2]".
    // That is not what happens with the sheet's own fixture, because
    // reindex numbers footnotes by where their FIRST reference appears and
    // the sheet puts its [^5] on a line BELOW the caret line. So the new
    // references are first and take number 1. (The wording would be right
    // if the [^5] sat on the caret line, ahead of the carets, which is the
    // shape test/multi-caret.test.ts uses.) Left red on purpose for Jason
    // to rule on: either the sheet's sentence is reworded, or the fixture
    // moves its [^5] above the carets.

    it("full parity with a single-caret press: same landing, same step count", async () => {
        const many = caretEditor(lines, carets);
        await insertAutonumFootnote(
            fakePlugin(many, {
                lintOnFootnoteCreation: true,
                lintReindex: true,
            }),
        );
        const one = caretEditor(lines, [carets[0]]);
        await insertAutonumFootnote(
            fakePlugin(one, {
                lintOnFootnoteCreation: true,
                lintReindex: true,
            }),
        );
        // the single-caret press leaves the caret in the same place, and
        // asks the editor to do its work over the same number of steps
        expect(many.cursor).toEqual(one.cursor);
        expect(many.transactions).toBe(one.transactions);
    });
});

describe("a drag-selection plus one extra Alt-clicked caret", () => {
    // Obsidian reports both at once: one range with a real width, and one
    // collapsed range that is just a caret. The plugin cannot tell which
    // one you meant, and quietly throwing the caret away is exactly the
    // silent drop the multi-caret press exists to prevent, so it refuses.
    const before = ["alpha bravo charlie", "delta echo"];

    // The shared fake offers either a single range or a list of carets,
    // never a mix, so this spec supplies listSelections itself (the same
    // move test/selection-to-footnote.test.ts makes for its multi-range
    // refusals).
    function mixedEditor(): FakeEditor {
        const doc = sharedFakeEditor(before, {
            cursor: { line: 0, ch: 6 },
            edits: true,
            wholeDoc: true,
        });
        (doc as unknown as { listSelections: () => unknown }).listSelections =
            () => [
                // the dragged word "bravo"
                { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 11 } },
                // and the extra caret, elsewhere
                { anchor: { line: 1, ch: 5 }, head: { line: 1, ch: 5 } },
            ];
        return doc;
    }

    it("the numbered key refuses with the one-continuous-stretch toast", async () => {
        const doc = mixedEditor();
        await insertAutonumFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(doc.transactions).toBe(0);
        expect(noticed(SelectionSpanNotice)).toBe(true);
    });

    it("the named key refuses the same way, before any modal opens", async () => {
        const doc = mixedEditor();
        await insertNamedFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(doc.transactions).toBe(0);
        expect(noticed(SelectionSpanNotice)).toBe(true);
    });

    it("the inline key refuses the same way", async () => {
        const doc = mixedEditor();
        await insertInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(before);
        expect(doc.transactions).toBe(0);
        expect(noticed(SelectionSpanNotice)).toBe(true);
    });
});
