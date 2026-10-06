import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (annoyance): an empty inline footnote that runs over two lines of a quote or callout
// reads as filled.
//
// What the user would see: with the caret inside "> a ^[" / "> ] b" (an inline footnote with
// nothing between its brackets), the numbered key hops the caret silently past the "]" instead
// of saying "This inline footnote is empty. Type its text between the brackets.", which it does
// for the same thing on one line or over two lines of a list item. With several carets, one
// in such an empty footnote and one in an empty one-line footnote, the press refuses with the
// notice about nesting footnotes instead of the empty-footnote notice.
//
// An "inline footnote" is "^[text]" written in the line itself; Obsidian lets one run over the
// line breaks of its paragraph (2e58d86).
//
// Hunt 2026-10-05, round 2, lens reader. Cluster R2.
//
// Source of truth: the empty-footnote notice for a one-line inline footnote in a quote and for
// one over two lines of a list item (the controls); a quote's "> " is the quote marker, not
// text of the footnote, since Obsidian strips it before it reads the paragraph.
//
// Cause: inlineNoteBody in src/commands/inline-footnotes.ts takes each later line of the
// footnote from column 0 of the line, so the "> " quote marker on the second line counts as
// the footnote's text and the body is never empty.
//
// Fix (2026-10-06): inlineNoteBody reads each later line from where its
// containers end (NoteReading.containerEnd).

const Empty = "This inline footnote is empty. Type its text between the brackets.";

async function press(lines: string[], cursor: { line: number; ch: number }) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, words: true, cursor });
    await insertAutonumFootnote(fakePlugin({}, doc));
    return { doc, messages: messages() };
}

describe("an empty inline footnote over two lines", () => {
    beforeEach(resetNotices);

    it("control: one line in a quote warns that it is empty", async () => {
        const { doc, messages } = await press(["> a ^[ ] b"], { line: 0, ch: 7 });
        expect(messages).toEqual([Empty]);
        expect(doc.getCursor()).toEqual({ line: 0, ch: 7 });
    });

    it("control: over two lines of a list item warns that it is empty", async () => {
        const { doc, messages } = await press(["- a ^[", "  ] b"], { line: 0, ch: 6 });
        expect(messages).toEqual([Empty]);
        expect(doc.getCursor()).toEqual({ line: 0, ch: 6 });
    });

    // Before the fix, no notice, and the caret hopped to line 1, column 3.
    it("over two lines of a quote warns that it is empty, as in a list item", async () => {
        const lines = ["> a ^[", "> ] b"];
        const { doc, messages } = await press(lines, { line: 0, ch: 6 });
        expect(messages).toEqual([Empty]);
        expect(doc.lines).toEqual(lines);
        expect(doc.getCursor()).toEqual({ line: 0, ch: 6 });
    });

    // Before the fix, no notice, and the caret hopped to line 2, column 3.
    it("over two lines of a callout warns that it is empty", async () => {
        const lines = ["> [!note]", "> a ^[", "> ] b"];
        const { doc, messages } = await press(lines, { line: 1, ch: 6 });
        expect(messages).toEqual([Empty]);
        expect(doc.getCursor()).toEqual({ line: 1, ch: 6 });
    });
});

describe("several carets in empty inline footnotes in a quote", () => {
    beforeEach(resetNotices);

    it("control: carets in two empty inline footnotes over two lines of a list item warn and stay", async () => {
        const lines = ["- a ^[", "  ] b ^[ ] c"];
        const doc = fakeEditor([...lines], { carets: [{ line: 0, ch: 6 }, { line: 1, ch: 8 }], edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin({}, doc));
        expect(doc.lines).toEqual(lines);
        expect(messages()).toEqual([Empty]);
    });

    // Before the fix, the note was unchanged, but the notice was the one about nesting footnotes.
    it("carets in an empty inline footnote over two quote lines and an empty one-line one warn as empty, as in a list item", async () => {
        const lines = ["> a ^[", "> ] b ^[ ] c"];
        const doc = fakeEditor([...lines], { carets: [{ line: 0, ch: 6 }, { line: 1, ch: 8 }], edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin({}, doc));
        expect(doc.lines).toEqual(lines);
        expect(messages()).toEqual([Empty]);
    });
});
