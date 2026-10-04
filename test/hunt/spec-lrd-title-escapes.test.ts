// Imported from the GLM 5.3 Flash cycle 7 hunt of 2026-09-16 (OpenCode worktree); 2 of 4 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// PROBED 2026-09-16 (GLM hunt cycle 7): an escaped quote in the title line breaks the whole link reference definition in Obsidian (one paragraph, label lazy), so that claim is refuted; a quoted title line under a column-0 definition is the quote's own paragraph and the label under it is lazy, so that claim holds and definitionStartLines now requires the title at the definition's depth.
import { describe, expect, it } from "vitest";


import { readNote } from "../../src/parsing/note-reading";

const startsOf = (doc: string): boolean[] => {
    const lines = doc.split("\n");
    return readNote(lines).labelLines;
};

// SPEC QUESTION (GLM 5.3 Flash cycle 11 hunt, 2026-09-16): which LRD
// title lines does Obsidian's link-reference-definition parser accept?
// definitionStartLines consumes a title line above a footnote label with
// the regex /^ {0,3}(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/ - no backslash
// escapes inside the quotes, no nested parentheses in the paren form, and
// no check that the title line sits at the link reference definition's
// own container depth. Three refinements of the two-line-LRD shape pinned
// in bug-label-under-multiline-lrd (title on the next line, probed in
// Reading view) are therefore unmodelled, and the label under each is
// judged LAZY where CommonMark consumes the title and shows the label as
// a definition (micromark oracle):
//
//   1. an escaped quote inside a double-quoted title: [foo]: /url over
//      "a \" b" - CommonMark consumes it as the title, so the label under
//      starts a definition; the plugin's regex stops at the escaped quote
//      and calls the label lazy.
//   2. a title line at a DIFFERENT container depth: [foo]: /url then
//      > "title" then a column-0 label. The title cannot cross the quote,
//      so the quote is its own block, the label under it is a lazy
//      continuation - and the plugin still consumes the quoted line as
//      the title and starts a definition at the label.
//   3. the nested-paren title (a(b)) - micromark REFUSES that one as a
//      title (the line stays a paragraph), and the plugin agrees by
//      accident; pinned as a control.
//
// What turns on the answer: the lazy-definition alert ("Add a blank line
// above it") and fix-lazy's inserted blank for a label Reading view
// already renders as a footnote - the same false advice the
// bug-label-after-pipeless-table family warns about. If instead Reading
// view behaves like the plugin, the pins below are the right model and
// nothing needs fixing; either way the exact title-line grammar Obsidian
// accepts has never been probed beyond bug-label-under-multiline-lrd's
// plain double-quoted title.
//
// NEEDS A LIVE CHECK: in Reading view, does the note
// "[foo]: /url\n\"a \\\" b\"\n[^1]: x" render the [^1] as a footnote, and
// does "> \"title\"" under a column-0 LRD leave a column-0 label under it
// lazy?
//
// Settings involved: `Fix definitions hidden by a missing blank line`
// and its alert twin.

describe("SPEC: which title lines end a link reference definition's block", () => {
    it("REFUTED: an escaped quote breaks the whole link reference definition, so the label under the title line is lazy", () => {
        // Reading view renders "[foo]: /url", the title line, and the label
        // as ONE paragraph with no link (probed 2026-09-16), so the label
        // is lazy prose there, exactly as the plugin already reads it
        const doc = '[foo]: /url\n"a \\" b"\n[^1]: x\n\nuse[^1]';
        expect(startsOf(doc)).toEqual([false, false, false, false, false]);
    });

    it("a quoted title line at a different container depth is not the LRD's title, so the label under it is lazy", () => {
        const doc = '[foo]: /url\n> "title"\n[^1]: x';
        // micromark: the quote ends the LRD's block; the column-0 label
        // lazily continues the quote's paragraph, so it is prose, and no
        // blank line can make it a definition (the blank would have to go
        // ABOVE the quote, not above the label)
        expect(startsOf(doc)).toEqual([false, false, false]);
    });

    it("control: a plain two-line LRD title ends the block (pinned)", () => {
        const doc = "[foo]: /url\n  \"title\"\n[^1]: x";
        expect(startsOf(doc)).toEqual([false, false, true]);
    });

    it("control: a nested-paren title is no title to micromark either (both readers agree)", () => {
        const doc = "[foo]: /url\n(a(b))\n[^1]: x";
        expect(startsOf(doc)).toEqual([false, false, false]);
    });
});