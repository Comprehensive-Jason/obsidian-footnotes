import { beforeEach, describe, expect, it } from "vitest";

import { convertInlineToNormalCommand } from "../../src/commands/convert-footnotes";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes, lintOptionsFromSettings } from "../../src/linting/linter";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// The section heading is found by its text, wherever the note holds that text
// outside protected lines, and how the note reads the line does not count.
//
// What the user sees: with a section heading of "Footnotes" or "**Notes**", a line
// typed right above the heading makes the words part of that paragraph. The lint
// and the press use the line that is already there. For a time they wrote a second
// copy, and the first press in a last paragraph that ended in the heading's text
// was refused with a toast about formatting. A "Title" over a "---" stays as it
// was before that change: the underline counts as the heading, so definitions
// already under a later divider stay put.
//
// Hunt 2026-11-06, cycle 10, on the back-out of cycle 9's H15 (1fb9c56); the lint
// hunter's findings 2, 4, and 5 and the parts hunter's whole-plugin survey.
// Source of truth: the README ("if it already exists in the note it's reused
// instead of duplicated") and the code at 0fb8ac3, where each row here passes.
// Severity: wrong output. Origin: regression from 1fb9c56.

type Extra = Partial<typeof DEFAULT_SETTINGS>;
const headed = (heading: string): Extra => ({ enableFootnoteSectionHeading: true, footnoteSectionHeading: heading });
const lint = (note: string, heading: string, extra: Extra = {}) => {
    const settings = { ...DEFAULT_SETTINGS, ...headed(heading), ...extra };
    return lintFootnotes(note, lintOptionsFromSettings(fakePlugin(settings), heading, note));
};
const editor = (note: string, line = 0, ch = 0) => fakeEditor(note.split("\n"), { wholeDoc: true, edits: true, cursor: { line, ch }, selection: { anchor: { line, ch }, head: { line, ch } } });
const copies = (note: string, heading: string) => note.split("\n").filter((line) => line === heading).length;

beforeEach(resetNotices);

describe("a heading of plain or bold text right under a line of text", () => {
    it.each(["**Notes**", "Notes:", "Footnotes"])("the lint reuses %s and writes no second copy", (heading) => {
        const after = lint(`Some text[^1]\n${heading}\n\n[^1]: one`, heading);
        expect(copies(after, heading)).toBe(1);
        expect(lint(after, heading)).toBe(after);
    });

    it("Remove empty section heading still finds it when nothing is left under it", () => {
        const after = lint("Body here.\n\nA typed line\nFootnotes\n", "Footnotes", { removeEmptySectionHeading: true });
        expect(copies(after, "Footnotes")).toBe(0);
    });

    it("control: a press on the blank line above it writes no second copy", async () => {
        const doc = editor("Body here.\n\nFootnotes\n\n[^1]: one\n", 1, 0);
        await insertAutonumFootnote(fakePlugin({ ...DEFAULT_SETTINGS, ...headed("Footnotes"), lintOnFootnoteCreation: false }, doc));
        expect(copies(doc.lines.join("\n"), "Footnotes")).toBe(1);
    });
});

describe("the first footnote in a last paragraph that ends in the heading's text", () => {
    it.each([
        ["a title under a divider heading", "Some text\n---", 0, "---"],
        ["the last paragraph underlined", "Intro\n\nLast para\n---", 2, "---"],
        ["a bold heading under the line", "Some text\n**Notes**", 0, "**Notes**"],
        ["a plain heading under two lines", "Some text\nmore\nNotes:", 0, "Notes:"],
    ])("a press is not refused: %s", async (_label, note, line, heading) => {
        const doc = editor(note, line, 4);
        await insertAutonumFootnote(fakePlugin({ ...headed(heading), insertAtEndOfWord: false, enablePopupEditor: false, enableFootnotePrefix: false }, doc));
        expect(doc.lines.join("\n")).toContain("[^1]: ");
        expect(messages()).toEqual([]);
    });

    it.each([
        ["a divider heading", "Some text^[x]\n---", "---"],
        ["a bold heading", "Some text^[x]\n**Notes**", "**Notes**"],
    ])("Convert inline to normal converts: %s", async (_label, note, heading) => {
        const doc = editor(note);
        await convertInlineToNormalCommand(fakePlugin({ ...DEFAULT_SETTINGS, ...headed(heading) }, doc));
        expect(doc.lines.join("\n")).toContain("[^1]: x");
    });
});

describe("a divider heading in a note with a title and dividers between its sections", () => {
    it("definitions under the last divider stay there", () => {
        const note = "Title\n---\n\none[^1]\n\n---\n\ntwo\n\n---\n\n[^1]: def";
        expect(lint(note, "---")).toBe(note);
    });

    it("a section of text after the first divider stays above the definitions", () => {
        const after = lint("Title\n---\n\none[^1]\n\n---\n\ntwo\n\n[^1]: def", "---");
        expect(after.indexOf("two")).toBeLessThan(after.indexOf("[^1]: def"));
    });
});
