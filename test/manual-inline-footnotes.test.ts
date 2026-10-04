import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FootnotePlugin from "../src/main";
import {
    insertNamedFootnote,
    pasteInlineFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";
import { resetNotices } from "./helpers/notices";

// These tests take over checks that used to sit on the retired manual sheet
// ("inline footnotes"). Both are about where a press leaves the caret and
// whether it touched the note or the clipboard, which the fake editor can
// answer.
//
// The sheet items this file replaces:
//   - the NAMED half of "NUMBERED and NAMED hotkeys inside the inline
//     footnote hop just past its closing bracket, nothing nested" (the
//     numbered half is already pinned by the smoke suite and by
//     test/empty-inline-footnote-guard.test.ts)
//   - "The PASTE hotkey navigates the same way inside [^1], and the
//     clipboard stays untouched for the next real paste"

// The sheet's own fixture line: a filled inline footnote, a reference with
// no definition, and a numbered reference that has one.
const FIXTURE =
    "Fixture: an inline footnote^[put the caret in here], a bare reference[^tag] with no definition, and a numbered footnote[^1] with one.";

function plugin(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: true,
            expandSelectionToWholeWords: true,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
            enableFootnoteSectionHeading: false,
            footnoteSectionHeading: "# Footnotes",
            enableRemoveBlankLastLines: true,
            lintOnFootnoteCreation: false,
        },
        doc,
    );
}

function noteWithCaret(lines: string[], line: number, ch: number): FakeEditor {
    return sharedFakeEditor(lines, {
        cursor: { line, ch },
        edits: true,
        wholeDoc: true,
        words: true,
    });
}

beforeEach(() => {
    resetNotices();
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the named hotkey inside a filled inline footnote", () => {
    it("hops the caret just past the closing bracket and writes nothing", async () => {
        const insideInline = FIXTURE.indexOf("put the caret") + 4;
        const doc = noteWithCaret([FIXTURE], 0, insideInline);
        await insertNamedFootnote(plugin(doc));
        expect(doc.lines).toEqual([FIXTURE]);
        expect(doc.appliedChanges).toEqual([]);
        expect(doc.cursor).toEqual({
            line: 0,
            ch: FIXTURE.indexOf("put the caret in here]") + "put the caret in here]".length,
        });
    });
});

describe("the paste hotkey inside a reference that has a definition", () => {
    it("jumps to the definition and never reads the clipboard", async () => {
        // count every clipboard read: the whole point of the check is that
        // the copied text is still there for the next real paste
        const reads = { count: 0 };
        vi.stubGlobal("navigator", {
            clipboard: {
                readText: () => {
                    reads.count++;
                    return Promise.resolve("clip");
                },
            },
        });
        const lines = [FIXTURE, "", "[^1]: the numbered fixture definition"];
        const insideReference = FIXTURE.indexOf("footnote[^1]") + "footnote[^".length + 1;
        const doc = noteWithCaret(lines, 0, insideReference);
        await pasteInlineFootnote(plugin(doc));
        expect(doc.lines).toEqual(lines);
        expect(doc.appliedChanges).toEqual([]);
        expect(reads.count).toBe(0);
        // the caret landed at the end of the definition line
        expect(doc.cursor).toEqual({
            line: 2,
            ch: "[^1]: the numbered fixture definition".length,
        });
    });
});
