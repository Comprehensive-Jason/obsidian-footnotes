import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { convertInlineFootnotesToNormal, convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { selectionPressHandled } from "../../src/commands/selection-footnote";
import type { TableCellEditor } from "../../src/editor/table-cursor";

// spec question: what should the convert commands do with a footnote whose
// text starts like a block, such as a heading ("# ") or a list item ("- ")?
//
// What it does now: normal to inline flattens it. "[^h]: # A heading
// starts this body" becomes "^[# A heading starts this body]", and the
// heading turns into plain text with a "#" in front. Inline to normal does
// the opposite: "^[# not a heading]" becomes "[^1]: # not a heading", and
// the plain text turns into a heading inside the footnote.
// What a user might expect: a conversion keeps the text looking the same.
// Normal to inline could skip such a footnote with a reason, as it skips
// others that cannot be written inline. Inline to normal could escape the
// "#" ("\#") so the text stays plain.
// Why it is a question and not a bug: the converters' contract covers
// what can be expressed inline, and nobody has ruled on whether a
// leading "#" or "-" in a footnote's text counts as structure worth
// keeping, or as a rare shape not worth a refusal.
//
// Hunt 2026-10-02, round 2, lens convert. Cluster V7.
//
// Source of truth: manual sheet 04 records "[^h]: # A heading starts this
// definition's body" rendering as a heading inside the footnote. Inline
// content has no headings, so "^[# A heading]" is plain text.
//
// Hunt 2026-10-08, cycle 6, cluster Z7, added two cases with an ordered
// list: a German citation "2. Aufl., S. 34" ("2nd edition, page 34") put on
// a new definition's label line reads as a numbered list starting at 2,
// from Convert inline to normal and from the selection conversion alike.
// Source of truth for those: live answer c6:z7-ordered ("[^1]: 2. Aufl., S.
// 34" draws footnote 1 as an ordered list starting at 2, Obsidian 1.14.4
// on sprout, 2026-10-08) and docs/obsidian-reading-rules.md E2 (text on
// the label line is read as a block start like any other).

const convert = (lines: string[]) => convertNormalFootnotesToInline(lines.join("\n"));

// Runs the inline-to-normal command on a fake editor holding `lines`.
function run(lines: string[]) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 } });
    convertInlineFootnotesToNormal(fakePlugin({}, doc), doc);
    return doc;
}

beforeEach(resetNotices);

// Characterization tests (behaviour pinned as it is, 2026-11-05, when the spec
// pins were sorted under Jason's scope rule of 2026-10-07): a footnote that
// starts with "# " is rare, and all its text stays, so the conversions keep
// doing this. They were it.fails until then. The numbered list further down is
// a plausible case, and Jason ruled on it (2026-11-05).
describe("a footnote whose text starts with a heading", () => {
    it("characterization: normal to inline converts it, and the heading becomes plain text with a '#' in front", () => {
        const r = convert(["x[^h]", "", "[^h]: # A heading starts this body"]);
        expect(r.converted).toBe(1);
        expect(r.markdown).toContain("x^[# A heading starts this body]");
    });

    it("characterization: inline to normal converts it, and the plain text becomes a heading in the definition", () => {
        const doc = run(["a^[# not a heading]"]);
        expect(doc.lines).toContain("[^1]: # not a heading");
    });
});

// The cases below came from hunt cycle 6, cluster Z7. They add a numbered
// list to the heading above, and the selection conversion to the convert
// command. Jason's ruling, 2026-11-05: the plugin writes the backslash when it
// writes the label line, because "[^1]: 2\. Aufl., S. 34" reads as the plain
// text "2. Aufl., S. 34", and "[^1]: 2\) Aufl." as "2) Aufl." (live answers,
// Obsidian 1.15.0).

/** Presses the numbered key over the first `selected` in `line`. */
async function pressOver(line: string, selected: string) {
    const from = line.indexOf(selected);
    const doc = fakeEditor([line], {
        wholeDoc: true,
        edits: true,
        cursor: { line: 0, ch: from },
        selection: { anchor: { line: 0, ch: from }, head: { line: 0, ch: from + selected.length } },
    });
    await insertAutonumFootnote(fakePlugin({ enablePopupEditor: false, expandSelectionToWholeWords: false, lintOnFootnoteCreation: false }, doc));
    return doc.lines;
}

describe("text that starts like a numbered list, moved onto a label line (ruling 2026-11-05)", () => {
    it("inline to normal: a German edition citation keeps reading as plain text in its footnote", () => {
        expect(run(["Vgl. die Neuausgabe^[2. Aufl., S. 34] dazu."]).lines).toEqual(["Vgl. die Neuausgabe[^1] dazu.", "", "[^1]: 2\\. Aufl., S. 34"]);
    });

    it("inline to normal: every definition it writes gets the backslash, not only the first", () => {
        expect(run(["a^[plain] b^[12. März] c^[2) Aufl.]"]).lines).toEqual(["a[^1] b[^2] c[^3]", "", "[^1]: plain", "[^2]: 12\\. März", "[^3]: 2\\) Aufl."]);
    });

    it("the selection conversion: selecting '2. Aufl., S. 34' out of a sentence keeps it plain text in the footnote", async () => {
        expect(await pressOver("Siehe dazu die 2. Aufl., S. 34 hier.", "2. Aufl., S. 34")).toEqual(["Siehe dazu die[^1] hier.", "", "[^1]: 2\\. Aufl., S. 34"]);
    });

    it("the selection conversion: the same with a round bracket", async () => {
        expect(await pressOver("Siehe dazu die 2) Aufl. hier.", "2) Aufl.")).toEqual(["Siehe dazu die[^1] hier.", "", "[^1]: 2\\) Aufl."]);
    });

    it("the round trip keeps one backslash: back to inline it reads the same", () => {
        const doc = run(["x^[2. Aufl.]"]);
        const back = convert(doc.lines);
        expect(back.markdown).toBe("x^[2\\. Aufl.]");
    });

    it("the selection conversion in a table cell: the same backslash", () => {
        const cellText = "2. Aufl., S. 34";
        const cell: TableCellEditor = {
            state: { doc: { toString: () => cellText }, selection: { main: { anchor: 0, head: cellText.length } } },
            dispatch: () => undefined,
        };
        const doc = fakeEditor([`| ${cellText} |`, "| --- |", "| x |"], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 2 } });
        selectionPressHandled(fakePlugin({ enablePopupEditor: false, expandSelectionToWholeWords: false }, doc), doc, cell, "autonum", { line: 0, ch: 2 });
        expect(doc.lines.at(-1)).toBe("[^1]: 2\\. Aufl., S. 34");
    });

    it("control: a number that does not end in '.' or ')' and a space is left as it is", () => {
        expect(run(["a^[2.5 mm] b^[2.a]"]).lines.slice(-2)).toEqual(["[^1]: 2.5 mm", "[^2]: 2.a"]);
    });

    it("control: selecting a whole numbered list still moves a list, with no backslash", async () => {
        const doc = fakeEditor(["Steps:", "", "1. First", "2. Second", "", "After."], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 2, ch: 0 },
            selection: { anchor: { line: 2, ch: 0 }, head: { line: 3, ch: 9 } },
        });
        await insertAutonumFootnote(fakePlugin({ enablePopupEditor: false, expandSelectionToWholeWords: false, lintOnFootnoteCreation: false }, doc));
        expect(doc.lines.slice(-2)).toEqual(["[^1]: 1. First", "    2. Second"]);
    });

    it("control: selecting 'S. 34' converts as plain text", async () => {
        const line = "Siehe dazu S. 34 hier.";
        const selected = "S. 34";
        const from = line.indexOf(selected);
        const doc = fakeEditor([line], {
            wholeDoc: true,
            edits: true,
            cursor: { line: 0, ch: from },
            selection: { anchor: { line: 0, ch: from }, head: { line: 0, ch: from + selected.length } },
        });
        await insertAutonumFootnote(fakePlugin({ enablePopupEditor: false, expandSelectionToWholeWords: false, lintOnFootnoteCreation: false }, doc));
        expect(doc.lines.at(-1)).toBe("[^1]: S. 34");
    });
});
