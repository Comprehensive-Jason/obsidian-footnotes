import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS, FootnotePluginSettings } from "../../src/settings";
import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// Ruling (Jason, 2026-11-05, the spec pin sort, entry 8, option a): with
// Lint on footnote creation on, the caret follows the new footnote through
// the lint's renumbering, even when another footnote looks exactly like it.
//
// What the user saw before: the note has "Alpha bravo charlie.[^1]" and an
// empty definition "[^1]: ", not filled in yet. The user presses the numbered
// key after "Al". The new reference comes first in the note, so the lint
// renumbers it to [^1] and the old one to [^2]. The caret stayed in "[^2]: ",
// the OLD footnote's definition, so the text went into the wrong footnote.
//
// The landing convention of the creation press is that the caret waits in the
// new definition (test/manual-multiple-cursors.test.ts, "lands the caret on
// the new empty definition"). The caret gets there through the write-back,
// which keeps a caret with its definition's name as the lint renames it (pin
// spec-caret-in-swapped-definition).
//
// Hunt 2026-10-02, round 3, lens press. Cluster R5.

/** A fake editor holding `lines` with one caret at line, ch. */
function ed(lines: string[], line: number, ch: number): FakeEditor {
    return fakeEditor(lines, { cursor: { line, ch }, edits: true, wholeDoc: true, words: true });
}

/** The plugin on its shipped defaults with the popup off, plus the settings given. */
function pl(doc: FakeEditor, s: Partial<FootnotePluginSettings> = {}) {
    return fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false, ...s }, doc);
}

beforeEach(resetNotices);

describe("the creation lint's landing when two definitions are both empty", () => {
    it("a second empty footnote created before an earlier, still empty one: the caret lands in the NEW footnote's definition", async () => {
        const doc = ed(["Alpha bravo charlie.[^1]", "", "[^1]: "], 0, 2);
        await insertAutonumFootnote(pl(doc, { lintOnFootnoteCreation: true }));
        // reindex: the new reference comes first in the note, so it is [^1]
        expect(doc.lines).toEqual(["Alpha[^1] bravo charlie.[^2]", "", "[^1]: ", "[^2]: "]);
        expect(doc.cursor).toEqual({ line: 2, ch: 6 });
    });
});
