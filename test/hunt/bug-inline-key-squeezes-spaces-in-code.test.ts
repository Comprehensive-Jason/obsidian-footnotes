import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { sanitizeInlineFootnoteContent } from "../../src/commands/inline-footnotes";
import { convertNormalFootnotesToInline } from "../../src/commands/convert-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";

// Bug: the text that goes into an inline footnote had every run of spaces
// and tabs squeezed to one space, inside code spans, math, and link
// targets too. An inline footnote has to fit on one line, so line breaks
// must go; two spaces in a row on one line never needed to.
//
// The inline key on the selection "the `git  log` command" (two spaces
// inside the code span) was refused with "the selection cuts through code,
// math, or other protected text. Select all of it or none of it.", advice
// the user had already followed: the squeeze changed the code, and the
// result gate saw it. "[[My  note]]" was refused as "part of a link".
// Converting a normal footnote whose definition holds such code to inline
// changed the code without a word.
//
// Found by the Fable 5.2 review (2026-11-11); Jason chose to fix it.

beforeEach(resetNotices);

/** Selects `selected` in a one-line note and presses the inline key. */
async function wrap(line: string, selected: string) {
    const from = line.indexOf(selected);
    const to = from + selected.length;
    const doc = fakeEditor([line], { cursor: { line: 0, ch: to }, selection: { anchor: { line: 0, ch: from }, head: { line: 0, ch: to } }, edits: true, wholeDoc: true, words: true });
    await insertInlineFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, doc));
    return { after: doc.lines[0], notices: messages() };
}

describe("the text of an inline footnote keeps its spaces", () => {
    it("the inline key wraps a code span with two spaces inside, as written", async () => {
        expect(await wrap("Run the `git  log` command now.", "the `git  log` command")).toEqual({ after: "Run^[the `git  log` command] now.", notices: [] });
    });

    it("the inline key wraps a code span with a tab inside, as written", async () => {
        expect(await wrap("Run the `a\tb` command now.", "the `a\tb` command")).toEqual({ after: "Run^[the `a\tb` command] now.", notices: [] });
    });

    it("the inline key wraps a wikilink whose target has two spaces, as written", async () => {
        expect(await wrap("See [[My  note]] for more.", "[[My  note]]")).toEqual({ after: "See^[[[My  note]]] for more.", notices: [] });
    });

    it("converting a normal footnote to inline keeps the code in it as written", () => {
        const result = convertNormalFootnotesToInline("Run it[^1] now.\n\n[^1]: the `git  log` command");
        expect(result.markdown).toBe("Run it^[the `git  log` command] now.");
    });

    // Characterization: line breaks still become one space, and the ends
    // are still trimmed.
    it("line breaks, with the spaces around them, become one space (as before)", () => {
        expect(sanitizeInlineFootnoteContent("  one\n  two \r\n three  ")).toBe("one two three");
    });

    it("a code span with single spaces wraps as before", async () => {
        expect(await wrap("Run the `git log` command now.", "the `git log` command")).toEqual({ after: "Run^[the `git log` command] now.", notices: [] });
    });
});
