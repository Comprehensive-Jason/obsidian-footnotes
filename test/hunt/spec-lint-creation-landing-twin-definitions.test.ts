import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintAfterFootnoteCreation } from "../../src/linting/linter";
import { DEFAULT_SETTINGS, FootnotePluginSettings } from "../../src/settings";
import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { PREFIXES } from "../helpers/prefixes";

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
// spec-caret-in-swapped-definition). With the popup on, the caret waits on the
// reference, so the popup is told the name the new footnote has after the lint
// (the last group below, and the smoke suite for the popup itself).
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

describe("the name the popup opens on", () => {
    // The popup route lints with the caret on the reference, then opens the
    // popup on the name this returns. The note is as the press left it.
    const lint = (doc: FakeEditor, created: string) => lintAfterFootnoteCreation(pl(doc, { lintOnFootnoteCreation: true }), doc, false, undefined, created);

    it("two empty definitions: the new footnote is found by the name it had, under the name it has now", () => {
        const doc = ed(["Alpha[^2] bravo charlie.[^1]", "", "[^1]: ", "[^2]: "], 0, "Alpha[^2]".length);
        expect(lint(doc, "2")).toBe("1");
        expect(doc.lines[0]).toBe("Alpha[^1] bravo charlie.[^2]");
    });

    it("with the old footnote written on: the unique empty definition still answers", () => {
        const doc = ed(["Alpha[^2] bravo charlie.[^1]", "", "[^1]: old", "[^2]: "], 0, "Alpha[^2]".length);
        expect(lint(doc, "2")).toBe("1");
    });

    it("a name that matches no definition gives no answer, and the caller keeps the name it has", () => {
        const doc = ed(["Alpha[^2] bravo charlie.[^1]", "", "[^1]: ", "[^2]: "], 0, "Alpha[^2]".length);
        expect(lint(doc, "9")).toBeNull();
    });

    it("no name given: two empty definitions still give no answer", () => {
        const doc = ed(["Alpha[^2] bravo charlie.[^1]", "", "[^1]: ", "[^2]: "], 0, "Alpha[^2]".length);
        expect(lintAfterFootnoteCreation(pl(doc, { lintOnFootnoteCreation: true }), doc, false)).toBeNull();
    });
});

// A conversion's definition holds the selected text, so it looks just like an
// older footnote with the same text. The note is as the press left it.
describe("a converted footnote with the same text as an older one", () => {
    const pressed = ["Alpha [^2] charlie.[^1]", "", "[^1]: bravo", "[^2]: bravo"];
    const settings = { lintOnFootnoteCreation: true };

    it("the caret, waiting in the new definition, stays with it", () => {
        const doc = ed(pressed, 3, "[^2]: bravo".length);
        lintAfterFootnoteCreation(pl(doc, settings), doc, true, "bravo");
        expect(doc.lines[0]).toBe("Alpha [^1] charlie.[^2]");
        expect(doc.cursor).toEqual({ line: 2, ch: "[^1]: bravo".length });
    });

    it("the popup opens on its name after the lint", () => {
        const doc = ed(pressed, 0, "Alpha [^2]".length);
        expect(lintAfterFootnoteCreation(pl(doc, settings), doc, false, "bravo", "2")).toBe("1");
    });
});

// The convention of 2026-08-08: a test about prefixes varies the separator.
describe.each(PREFIXES)('with the footnote prefix "%s"', (prefix) => {
    const note = (first: string, second: string) => ["---", `footnote-prefix: ${prefix}`, "---", `Alpha[^${prefix}${first}] bravo charlie.[^${prefix}${second}]`, "", `[^${prefix}1]: `, `[^${prefix}2]: `];

    it("the name the popup opens on follows the renumbering", () => {
        const doc = ed(note("2", "1"), 3, 2);
        expect(lintAfterFootnoteCreation(pl(doc, { lintOnFootnoteCreation: true, enableFootnotePrefix: true }), doc, false, undefined, `${prefix}2`)).toBe(`${prefix}1`);
        expect(doc.lines).toEqual(note("1", "2"));
    });

    it("the caret lands in the new footnote's definition", async () => {
        const lines = ["---", `footnote-prefix: ${prefix}`, "---", `Alpha bravo charlie.[^${prefix}1]`, "", `[^${prefix}1]: `];
        const doc = ed(lines, 3, 2);
        await insertAutonumFootnote(pl(doc, { lintOnFootnoteCreation: true, enableFootnotePrefix: true }));
        expect(doc.lines).toEqual(note("1", "2"));
        expect(doc.cursor).toEqual({ line: 5, ch: `[^${prefix}1]: `.length });
    });
});
