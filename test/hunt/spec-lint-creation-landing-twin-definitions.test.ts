import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS, FootnotePluginSettings } from "../../src/settings";
import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// spec question: with Lint on footnote creation on, where should the caret
// land when the lint renumbers the new footnote and another footnote looks
// exactly like it?
//
// What it does now: the note has "Alpha bravo charlie.[^1]" and an empty
// definition "[^1]: ", not filled in yet. The user presses the numbered key
// after "Al". The new reference comes first in the note, so the lint
// renumbers it to [^1] and the old one to [^2]. The caret is left in
// "[^2]: ", the OLD footnote's definition. With the popup on, the
// popup is bound to the old footnote's name the same way.
// What a user might expect: the caret waits in the NEW footnote's
// definition, as it does when the lint changes nothing
// (test/manual-multiple-cursors.test.ts, "lands the caret on the new empty
// definition").
// Why it is a question and not a bug: after the lint the plugin finds the
// new footnote by its shape, as the note's one empty definition
// (uniqueEmptyDefinitionName in src/linting/linter.ts), because reindex
// can rename it. With two empty definitions it cannot tell them apart and,
// by design, does not guess. Whether to follow the new footnote through
// the lint's renumbering, skip the renumbering for this press, or land the
// caret on the new reference instead is a product decision for Jason.
//
// Hunt 2026-10-02, round 3, lens press. Cluster R5.
//
// Source of truth: the landing convention of the creation press (the
// caret waits in the new definition), as test/manual-multiple-cursors.test.ts
// pins it.

/** A fake editor holding `lines` with one caret at line, ch. */
function ed(lines: string[], line: number, ch: number): FakeEditor {
    return fakeEditor(lines, { cursor: { line, ch }, edits: true, wholeDoc: true, words: true });
}

/** The plugin on its shipped defaults with the popup off, plus the settings given. */
function pl(doc: FakeEditor, s: Partial<FootnotePluginSettings> = {}) {
    return fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false, ...s }, doc);
}

beforeEach(resetNotices);

describe("spec question: the creation lint's landing when two definitions are both empty", () => {
    it.fails("a second empty footnote created before an earlier, still empty one: the caret lands in the NEW footnote's definition", async () => {
        const doc = ed(["Alpha bravo charlie.[^1]", "", "[^1]: "], 0, 2);
        await insertAutonumFootnote(pl(doc, { lintOnFootnoteCreation: true }));
        // reindex: the new reference comes first in the note, so it is [^1]
        expect(doc.lines).toEqual(["Alpha[^1] bravo charlie.[^2]", "", "[^1]: ", "[^2]: "]);
        // Today: { line: 3, ch: 6 }, the old footnote's definition.
        expect(doc.cursor).toEqual({ line: 2, ch: 6 });
    });
});
