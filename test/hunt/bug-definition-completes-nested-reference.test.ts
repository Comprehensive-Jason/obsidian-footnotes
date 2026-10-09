// Found by the subtraction pass's press job (sub-press, 2026-10-08, "needs
// Jason's eyes" 1), confirmed by Jason in his own vault and ruled a bug on
// 2026-10-09 (ruling 1). Origin: pre-existing at 3a47f7a.
//
// The note "Text [^x] here[^1]." / "" / "[^1]: One." / "see [^x] too" has
// two references to [^x] and no definition for it, so Obsidian draws both
// as plain text. The second one sits on [^1]'s lazy line, a line typed
// straight under the definition, which belongs to [^1]'s text. A press on
// the first [^x] (the numbered, named, or inline key) writes "[^x]: " at
// the bottom of the note, and the second [^x] comes alive as a footnote
// inside [^1]'s definition: a nested footnote, which the plugin never
// creates (ADR 0001).
//
// Cause: the result gate's check 2 compared the footnotes inside each
// definition before and after the edit, but counted a reference with no
// definition as a footnote already, so the [^x] inside [^1] looked the same
// on both sides.
import { describe, expect, it, beforeEach } from "vitest";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { judgeEdit } from "../../src/editor/result-gate";
import { NestedFootnoteNotice } from "../../src/editor/notice";
import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "../helpers/fake-plugin";
import { noticeCalls } from "../mocks/obsidian";
import { resetNotices } from "../helpers/notices";

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

const DOC = ["Text [^x] here[^1].", "", "[^1]: One.", "see [^x] too"];

const presses: [string, (plugin: FootnotePlugin) => Promise<unknown>][] = [
    ["numbered", insertAutonumFootnote],
    ["named", insertNamedFootnote],
    ["inline", insertInlineFootnote],
];

describe("a definition that would bring a reference inside another footnote to life", () => {
    beforeEach(() => {
        resetNotices();
    });

    for (const [key, press] of presses) {
        it(`the ${key} key on the first [^x] leaves the note as it is, with the nested-footnote notice`, async () => {
            const doc = fakeEditor(DOC, { carets: [{ line: 0, ch: 7 }], edits: true, wholeDoc: true });
            await press(fakePlugin(doc));
            expect(doc.lines.join("\n")).toBe(DOC.join("\n"));
            expect(noticeCalls.some((call) => call[0] === NestedFootnoteNotice)).toBe(true);
        });
    }

    it("the gate refuses the definition as nesting, though both references were in the note before", () => {
        const after = [...DOC, "", "[^x]: "];
        const verdict = judgeEdit(DOC, after, { created: [{ kind: "footnote", name: "x", references: [], definition: { line: 5, lines: 1 } }] });
        expect(verdict).toMatchObject({ pass: false, reason: "nested", check: 2 });
    });

    it("the gate finds the reference far from the edit, in a definition in the middle of a long note", () => {
        const filler = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? `Paragraph ${String(i)}.` : ""));
        const before = ["Text [^x] here[^1].", "", "[^1]: One.", "see [^x] too", "", ...filler];
        const after = [...before, "", "[^x]: "];
        const verdict = judgeEdit(before, after, { created: [{ kind: "footnote", name: "x", references: [], definition: { line: after.length - 1, lines: 1 } }] });
        expect(verdict).toMatchObject({ pass: false, reason: "nested", check: 2 });
    });

    it("control: with a blank line between, the second [^x] is prose and the press writes the definition", async () => {
        const lines = ["Text [^x] here[^1].", "", "[^1]: One.", "", "see [^x] too"];
        const doc = fakeEditor(lines, { carets: [{ line: 0, ch: 7 }], edits: true, wholeDoc: true });
        await insertAutonumFootnote(fakePlugin(doc));
        // the new definition joins the definition block under [^1]
        expect(doc.lines.join("\n")).toBe(["Text [^x] here[^1].", "", "[^1]: One.", "[^x]: ", "", "see [^x] too"].join("\n"));
    });

    it("control: deleting the definition of a footnote nested by hand passes, since nothing new is nested", () => {
        const before = ["Text [^x] here[^1].", "", "[^1]: One.", "see [^x] too", "", "[^x]: Ex."];
        const after = ["Text [^x] here[^1].", "", "[^1]: One.", "see [^x] too"];
        expect(judgeEdit(before, after, { removed: ["x"] })).toEqual({ pass: true });
    });
});
