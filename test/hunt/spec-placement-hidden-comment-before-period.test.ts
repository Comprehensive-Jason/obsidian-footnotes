import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// spec question: when a comment that Reading view hides sits between a
// word and its period, should a press under "After punctuation" step over
// the comment and the period?
//
// What it does now: a numbered press at the end of "word" in
// "word<!-- c -->. more" writes "word[^1]<!-- c -->. more", in front of the
// comment. Reading view hides the comment and shows "word¹." with the
// footnote number before the period. The same with an Obsidian comment,
// "word%%c%%. more".
// What a user might expect: "word<!-- c -->.[^1] more", which Reading view
// shows as "word.¹", as the setting says.
// Why it is a question and not a bug: the comment is text the user wrote
// between the word and the period, and the press stops at the first thing
// that is not punctuation. Stepping over a comment means deciding that a
// hidden comment does not count, and the comment may be a note about the
// word itself.
//
// A "comment" is "<!-- ... -->" (HTML) or "%% ... %%" (Obsidian's own);
// both are hidden in Reading view.
//
// Options:
//   (a) step over a comment that sits directly before punctuation, so the
//       footnote lands after the period, as Reading view would show it;
//   (b) keep the press as it is: a comment stops the walk like any text.
// The tests below take option (a).
//
// Hunt 2026-10-06, cycle 4, lens press. Cluster P5.
//
// Origin: pre-existing.
//
// Source of truth: the "Footnote placement" setting ("after punctuation"),
// judged on what Reading view shows.

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

describe("spec question: a hidden comment between a word and its period", () => {
    // Now: "word[^1]<!-- c -->. more".
    it.fails("press at the end of 'word' in 'word<!-- c -->. more' lands after the period", async () => {
        const doc = fakeEditor(["word<!-- c -->. more"], { cursor: { line: 0, ch: 2 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(After, doc));
        expect(doc.lines[0]).toBe("word<!-- c -->.[^1] more");
    });

    // Now: "word[^1]%%c%%. more".
    it.fails("press at the end of 'word' in 'word%%c%%. more' lands after the period", async () => {
        const doc = fakeEditor(["word%%c%%. more"], { cursor: { line: 0, ch: 2 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(After, doc));
        expect(doc.lines[0]).toBe("word%%c%%.[^1] more");
    });
});
