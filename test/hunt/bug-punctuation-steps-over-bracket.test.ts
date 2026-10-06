import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { footnoteAfterPunctuation } from "../../src/linting/rules/footnote-after-punctuation";
import { lintFootnotes } from "../../src/linting/linter";
import { readNote } from "../../src/parsing/note-reading";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// BUG (wrong output): the punctuation lint rule moves a reference out past
// the "]" of bracketed text that is no link, which kills it.
//
// What the user would see: the note says "I said [some text[^1]] here",
// a live footnote at the end of bracketed text (no "[some text]: url"
// line makes it a link). The lint's punctuation rule treats the "]" as a
// closing mark, like a quote's closing mark, and moves the reference out
// past it: "I said [some text][^1] here". That reads as a reference link
// with the label "^1", so the footnote's reference is gone and its
// definition is orphaned. On default settings the user gets there in two
// steps: select the last word inside the brackets and press the numbered
// key (which writes "I said [some[^1]] here"), then lint.
//
// Hunt 2026-10-05, round 2, lens press. Cluster P10.
//
// Source of truth: Obsidian 1.14.4, asked live on 2026-10-05: "I said
// [some[^1] text] here" holds a live [^1]. The plugin's reader, and the
// born-dead check since 6d37374, read "[some text][^1]" as a reference
// link with the label "^1", not as a footnote. The round-2 hunt brief:
// under Don't move, bracketed text is not stepped over (Jason,
// 2026-09-22; 6d37374).
//
// Cause: swapInSegment in src/linting/rules/footnote-after-punctuation.ts
// takes the run of punctuation and closing marks after a reference from
// referenceLandingAfter, which counts "]" as a closing mark; nothing asks
// whether the moved reference is still live after the "]". Not a
// regression: it predates 6d37374.

function liveNames(text: string, line = 0): string[] {
    return readNote(text.split("\n")).referencesOn(line).map((o) => o.name);
}

beforeEach(resetNotices);

describe("the punctuation rule and bracketed text", () => {
    it.fails("after: '[some text[^1]] here' keeps [^1] live", () => {
        const out = footnoteAfterPunctuation("I said [some text[^1]] here\n\n[^1]: note", "after");
        expect(liveNames(out)).toEqual(["1"]);
    });
    it.fails("after: '[some text[^1]]' at the line's end keeps [^1] live", () => {
        const out = footnoteAfterPunctuation("I said [some text[^1]]\n\n[^1]: note", "after");
        expect(liveNames(out)).toEqual(["1"]);
    });
    it.fails("before: '[some text[^1]] here' keeps [^1] live", () => {
        const out = footnoteAfterPunctuation("I said [some text[^1]] here\n\n[^1]: note", "before");
        expect(liveNames(out)).toEqual(["1"]);
    });
});

describe("default settings: convert the last word in brackets, then lint", () => {
    it.fails("the default lint keeps the converted footnote live", async () => {
        const doc = fakeEditor(["I said [some text] here"], {
            cursor: { line: 0, ch: 17 },
            selection: { anchor: { line: 0, ch: 13 }, head: { line: 0, ch: 17 } },
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false, lintOnFootnoteCreation: false }, doc));
        // The conversion itself is fine: "I said [some[^1]] here" / "" / "[^1]: text".
        expect(doc.lines[0]).toBe("I said [some[^1]] here");
        // Today the lint writes "I said [some][^1] here", a reference link with the label "^1".
        expect(liveNames(lintFootnotes(doc.lines.join("\n"), {}))).toEqual(["1"]);
    });
});
