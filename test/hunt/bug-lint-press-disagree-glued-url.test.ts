import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// BUG (annoyance): a press and the lint disagree about where a footnote
// goes when a closing mark is glued to a bare web address, so the lint
// moves what the press just wrote.
//
// What the user would see: with footnote placement set to after
// punctuation, a numbered press at the end of "word" in
// "word==https://e.com" writes "word[^1]==https://e.com". The next save
// lints it into "word==[^1]https://e.com", with the footnote number between
// the "==" and the address.
//
// A "bare" web address is one typed as is, not inside "[text](...)" or
// "<...>"; Obsidian still shows it as a link.
//
// Hunt 2026-10-06, cycle 4, lens press. Cluster P4.
//
// Origin: pre-existing.
//
// Source of truth: src/parsing/landing.ts, whose walks the press and the
// lint rule both use "so the two can never disagree about where a
// reference belongs"; the lint's promise to leave alone what a press just
// wrote under the same settings.
//
// Cause: the punctuation rule (src/linting/rules/footnote-after-punctuation.ts)
// walks the "masked twin" of the line, a copy in which a bare web address
// or email is blotted out. There the "==" in front of it reads as a
// closing mark to step over. The press walks the line as written and stops
// in front of the "==", which opens a highlight there.

beforeEach(resetNotices);

const After = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    expandSelectionToWholeWords: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

describe("lint vs press before a glued bare web address", () => {
    // Now: the lint gives "word==[^1]https://e.com".
    it("lint (after) leaves 'word[^1]==https://e.com' as the press wrote it", async () => {
        const doc = fakeEditor(["word==https://e.com"], { cursor: { line: 0, ch: 2 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(After, doc));
        const pressed = doc.lines.join("\n");
        expect(footnoteAfterPunctuation(pressed, "after")).toBe(pressed);
    });
});
