// RULED 2026-10-03 by Jason's ruling 1, option a (a definition inside a list item is modelled everywhere, like any other; the runtime swap, step 1): a press in an in-item definition's label jumps back to its reference, and a press, selection, or second caret in its text or continuation lines refuses to nest, exactly as for the column-0 twin. The question below is kept as it was asked.
import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// spec question: should the press guards know footnote definitions written
// inside a list item, so that a press in one refuses or jumps back the way
// it does in a column-0 definition?
//
// What it does now: a press in the text of "- [^la]: a definition ..."
// writes a new reference into that definition, which is a footnote inside
// a footnote. The same goes for its continuation lines (indented or lazy),
// for a definition indented to the item's margin, for a selection in its
// text, and for one caret of a multi-caret press. A press inside the
// in-item LABEL does not jump back to the reference "alpha[^la]" as a
// column-0 label does.
// What a user might expect: what the column-0 twin does - the press
// refuses with the nested-footnote toast, and a press on the label jumps
// back to the reference.
// Why it is a question and not a bug: Jason's ruling 1 (2026-09-20,
// commit f098798) took option b: an in-item definition "is recognized
// where ignoring it misfired" (the orphan alert and its deletion, the
// navigate-or-create decision, reindex, rename) and nowhere else. The
// reader's own header, src/parsing/list-item-definitions.ts, says
// "Modelling these definitions everywhere (option a) waits until more such
// cases turn up." These are such cases. Whether to add the press guards to
// option b's list or to move to option a is Jason's call.
//
// Hunt 2026-10-02, round 3, lens press. Cluster R3. The last group below
// comes from the reg lens (probe reg-5, its first group): the same
// question, reached through ruling 1's list, so it is folded in here.
//
// Source of truth: ADR 0001 (the plugin never creates a nested footnote);
// ruling 1 (in-item definitions are real definitions; Reading view
// renders them, probed 2026-09-16 and 2026-09-21); micromark with
// gfm-footnote renders "- [^1]: def" over "  more words" as ONE footnote,
// "def more words", so the continuation line is inside it.

/** A fake editor holding `lines` with one caret at line, ch. */
function ed(lines: string[], line: number, ch: number): FakeEditor {
    return fakeEditor(lines, { cursor: { line, ch }, edits: true, wholeDoc: true, words: true });
}

/** The plugin on its shipped defaults, with the popup off so the caret stays in the note. */
function pl(doc: FakeEditor) {
    return fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, doc);
}

beforeEach(resetNotices);

// the note from test/list-item-definitions.test.ts (ruling 1, f098798)
const NOTE = [
    "- [^la]: a definition written right after the list marker",
    "- item two",
    "",
    "- item three",
    "",
    "    [^lb]: a definition indented to the item's margin (four spaces)",
    "",
    "Uses: alpha[^la] and bravo[^lb].",
];

describe("spec question: a press in an in-item definition", () => {
    it("numbered press in the text of a marker-line in-item definition does not nest a reference in it", async () => {
        const doc = ed(NOTE, 0, NOTE[0].indexOf("written") + 2);
        await insertAutonumFootnote(pl(doc));
        // Today: "... written[^1] right after ...", a reference inside footnote la.
        expect(doc.lines[0]).toBe(NOTE[0]);
    });

    it("a press inside an in-item definition's LABEL jumps back to the reference, like a column-0 label", async () => {
        const doc = ed(NOTE, 0, 4); // inside [^la] of the label
        await insertAutonumFootnote(pl(doc));
        expect(doc.lines).toEqual(NOTE);
        // Today: the caret goes to the end of the label's own line.
        expect(doc.cursor).toEqual({ line: 7, ch: NOTE[7].indexOf("[^la]") + 5 });
    });

    it("control: a press inside a column-0 label jumps back to the reference", async () => {
        const lines = ["Uses: alpha[^la].", "", "[^la]: def"];
        const doc = ed(lines, 2, 2);
        await insertAutonumFootnote(pl(doc));
        expect(doc.cursor).toEqual({ line: 0, ch: lines[0].indexOf("[^la]") + 5 });
    });
});

// The settings of the reg lens: insert at end of word on, everything else
// that could move text afterwards off.
const settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

/** Did the press leave the in-item definition (lines from..to) without a reference or inline footnote inside it? */
function noFootnoteInside(lines: string[], from: number, to: number): boolean {
    return lines.slice(from, to + 1).every((l, k) => {
        const body = k === 0 ? l.replace(/^\s*(?:[-*+]|\d+[.)])?\s*\[\^1\]:/, "") : l;
        return !/\[\^\d+\]|\^\[/.test(body);
    });
}

describe("spec question: a press on an in-item definition's text, its continuation lines, and through a selection or a second caret", () => {
    beforeEach(resetNotices);

    // name, the note, the caret's line and ch, and the definition's last line
    const cases: [string, string[], number, number, number][] = [
        ["text on the marker line", ["text[^1] here", "", "- [^1]: def words"], 2, 13, 2],
        ["lazy continuation at the item margin", ["text[^1] here", "", "- [^1]: def", "  more words"], 3, 6, 3],
        ["indented continuation", ["text[^1] here", "", "- [^1]: def words", "    more words"], 3, 6, 3],
        ["continuation of a margin label", ["text[^1] here", "", "- item", "", "  [^1]: def", "      more words"], 5, 8, 5],
    ];

    for (const [name, rows, line, ch, last] of cases) {
        for (const [key, command] of [
            ["numbered", insertAutonumFootnote],
            ["inline", insertInlineFootnote],
        ] as const) {
            it(`${key} key, ${name}: no footnote is written inside the definition`, async () => {
                const doc = fakeEditor([...rows], { cursor: { line, ch }, edits: true, wholeDoc: true, words: true });
                await command(fakePlugin(settings, doc));
                const first = rows.findIndex((l) => l.includes("[^1]:"));
                expect(noFootnoteInside(doc.lines, first, last)).toBe(true);
            });
        }
    }

    it("control: the column-0 twin (caret on the text) does not nest", async () => {
        const rows = ["text[^1] here", "", "[^1]: def words"];
        const doc = fakeEditor([...rows], { cursor: { line: 2, ch: 11 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(rows);
    });

    it("a selection of words in the in-item text is refused like the column-0 twin", async () => {
        const rows = ["text[^1] here", "", "- [^1]: def words"];
        const doc = fakeEditor([...rows], {
            selection: { anchor: { line: 2, ch: 12 }, head: { line: 2, ch: 17 } },
            cursor: { line: 2, ch: 17 },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(rows);
    });

    it("a multi-caret press with one caret in the in-item text refuses the lot", async () => {
        const rows = ["text here", "", "- [^1]: def", "  more words"];
        const doc = fakeEditor([...rows], {
            carets: [
                { line: 0, ch: 4 },
                { line: 3, ch: 6 },
            ],
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(settings, doc));
        expect(doc.lines).toEqual(rows);
    });
});
