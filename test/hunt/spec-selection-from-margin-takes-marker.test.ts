import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { BlockSyntaxNotice } from "../../src/editor/notice";

// spec question: when a selection starts at the left margin of a quote,
// list, or heading line, takes its "> ", "- ", or "# " with it, and ends
// mid-line, should the footnote leave that marker on the line?
//
// What it does now: "> The sky is blue today." with "> The sky" selected
// (a drag from the left margin) and the numbered key pressed gives "[^1]
// is blue today." plus "[^1]: > The sky": the line is no longer quoted,
// and the footnote's text is a quote. "- milk and eggs" with "- milk"
// selected gives "[^1] and eggs": the bullet is gone (with a second item
// "- bread" under it the press refuses instead, naming "code, math, or
// other protected text", which is not what is in the way). The inline key
// gives "^[> The sky] is blue today.", unquoted too. "# Heading here" with
// "# Heading" selected stops being a heading the same way.
// What a user might expect: the line keeps its marker, and only the text
// after it goes into the footnote.
// Why it is a question and not a bug: whole-line and whole-block
// selections that carry a quote into the footnote are a documented
// feature (README: "the whole block becomes one multi-paragraph footnote
// ... callouts"); only the part-line selection is in question.
//
// A "marker" here is the list, quote, or heading syntax at the start of a
// line ("- ", "> ", "# ").
//
// Options:
//   (a) start the selection where the line's block syntax ends
//       (blockSyntaxEnd), so the marker stays on the line (recommended:
//       the user's text goes into the footnote and the line keeps its
//       shape);
//   (b) refuse with the block-syntax notice.
// The tests below accept either: the line keeps its quote, list item, or
// heading, or the press refuses with a notice.
//
// Hunt 2026-10-06, cycle 3, lens press. Cluster P4.
//
// Origin: pre-existing (cec4352 does the same).
//
// Source of truth: the README ("Footnotes are never ... written into a
// line's formatting (in front of a list or quote marker ...), where they
// would break the line"); absorbLeadingSpace's docstring (a marker's space
// is left alone, since stripping it "would break the structure").
//
// Answered (Jason's ruling B3, 2026-10-08, stage 3 of the result gate
// design): option (b). The result gate refuses the press, since the rest of
// the line would stop being a quote, a list item, or a heading, and the
// notice is the block-syntax one. The four tests were it.fails until then;
// they now hold the note unchanged with that notice.

const Settings = {
    insertAtEndOfWord: true,
    expandSelectionToWholeWords: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);

/** Selects columns `from` to `to` of line 0 and presses the given key (the numbered key by default). */
async function convert(lines: string[], from: number, to: number, fn = insertAutonumFootnote) {
    const doc = fakeEditor([...lines], {
        cursor: { line: 0, ch: to },
        selection: { anchor: { line: 0, ch: from }, head: { line: 0, ch: to } },
        edits: true,
        wholeDoc: true,
        words: true,
    });
    await fn(fakePlugin(Settings, doc));
    return doc;
}

/** Whether line 0 is still read inside a quote, a list item, or a heading, or the press refused with a notice. */
function keptOrRefused(before: string[], after: string[], kind: "quote" | "list" | "heading"): boolean {
    if (after.join("\n") === before.join("\n")) return messages().includes(BlockSyntaxNotice);
    const blocks = readNote(after).lineBlocks[0] ?? "";
    return new RegExp(kind).test(blocks);
}

describe("spec question: a selection from column 0 over a line's marker, ending mid-line", () => {
    // Before the ruling: "[^1] is blue today." / "" / "[^1]: > The sky", no notice.
    it("quote, numbered key: the rest of the line stays quoted", async () => {
        const before = ["> The sky is blue today."];
        const doc = await convert(before, 0, "> The sky".length);
        expect(keptOrRefused(before, doc.lines, "quote")).toBe(true);
    });

    it("list item, numbered key: the rest of the line stays a list item", async () => {
        const before = ["- milk and eggs"];
        const doc = await convert(before, 0, "- milk".length);
        expect(keptOrRefused(before, doc.lines, "list")).toBe(true);
    });

    it("quote, inline key: the rest of the line stays quoted", async () => {
        const before = ["> The sky is blue today."];
        const doc = await convert(before, 0, "> The sky".length, insertInlineFootnote);
        expect(keptOrRefused(before, doc.lines, "quote")).toBe(true);
    });

    it("heading, numbered key: the rest of the line stays a heading", async () => {
        const before = ["# Heading here"];
        const doc = await convert(before, 0, "# Heading".length);
        expect(keptOrRefused(before, doc.lines, "heading")).toBe(true);
    });

    it("control: the same selection starting after the marker keeps the quote", async () => {
        const before = ["> The sky is blue today."];
        const doc = await convert(before, 2, "> The sky".length);
        expect(doc.lines[0]).toBe("> [^1] is blue today.");
    });

    it("control: a heading line read before the press is a heading", () => {
        expect(readNote(["# Heading here"]).lineBlocks[0]).toMatch(/heading/);
    });
});
