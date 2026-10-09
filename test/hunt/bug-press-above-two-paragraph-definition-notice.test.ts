// BUG (annoyance): a press on the blank line above a footnote that has a
// second paragraph is refused with the wrong notice.
//
// What the user would see: "Text with a long note[^1] and more." / "" /
// "[^1]: First paragraph." / "" / "    Second paragraph." / "" / "After.",
// caret on the blank line under the text, numbered key. It is refused,
// rightly, but with "No footnote was created: footnotes can't go inside
// code, math, or other protected text." The caret is on a blank line and
// there is no code in the note. Above a one-paragraph footnote the same
// press says "...a footnote here would break the line's formatting. Move
// the caret into the text."
//
// Hunt 2026-10-09, cycle 8. Cluster V6, lens presses and selections.
// Source of truth: ruling B2 (runs/gate-s3.report.md): above a definition,
// the block-syntax notice; ruling 3 of 2026-10-09 treats protected text an
// edit would make out of nothing as formatting.
// Origin: pre-existing (red at 34d5377 and 3a47f7a).

// Annoyance: a press on the blank line
// between the text and a footnote with a second paragraph is refused with
// the protected-text notice.
//
// "Text with a long note[^1] and more." / "" / "[^1]: First paragraph." /
// "" / "    Second paragraph." / "" / "After." The caret is on the blank
// line 1, between the text and the definition, and the numbered key is
// pressed. Ruling B2 (runs/gate-s3.report.md, "What a user sees change"):
// a press on an empty line above a definition is refused with the
// block-syntax notice ("a footnote here would break the line's formatting"),
// and only one above indented code gets the protected-text notice. Here the
// caret is above a definition and the notice says "footnotes can't go
// inside code, math, or other protected text", though no code is in sight:
// the "[^2]" the press would write makes "[^1]: First paragraph." lazy text
// of a paragraph, so the definition's indented second paragraph would turn
// into indented code, and check 3 (protected text) runs before check 5.
import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { BlockSyntaxNotice } from "../../src/editor/notice";
import { ProtectedCreationNotice } from "../../src/editor/insertion-liveness";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

const settings = { ...DEFAULT_SETTINGS, enablePopupEditor: false };

async function pressAt(lines: string[], line: number) {
    const doc = fakeEditor(lines, { cursor: { line, ch: 0 }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(settings, doc));
    return doc;
}

beforeEach(resetNotices);

describe("a press on the blank line above a footnote with a second paragraph", () => {
    it("is refused with the block-syntax notice, as above any definition (ruling B2)", async () => {
        const lines = ["Text with a long note[^1] and more.", "", "[^1]: First paragraph.", "", "    Second paragraph.", "", "After."];
        const doc = await pressAt(lines, 1);
        expect(doc.lines).toEqual(lines);
        expect(messages()).not.toContain(ProtectedCreationNotice);
        expect(messages()).toContain(BlockSyntaxNotice);
    });

    it("control: above a one-paragraph definition the block-syntax notice shows", async () => {
        const lines = ["Text with a note[^1] and more.", "", "[^1]: First paragraph.", "", "After."];
        const doc = await pressAt(lines, 1);
        expect(doc.lines).toEqual(lines);
        expect(messages()).toContain(BlockSyntaxNotice);
    });
});
