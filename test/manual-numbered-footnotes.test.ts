import { describe, expect, it } from "vitest";

import type FootnotePlugin from "../src/main";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import {
    fakeEditor as sharedFakeEditor,
    FakeEditor,
} from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";

// These tests take over checks that used to sit on the retired manual sheet
// ("numbered footnotes"). Jason had to do them by hand in Obsidian; they
// are all about the TEXT a press leaves behind, which the fake editor can
// see perfectly well, so they belong here instead.
//
// The sheet items this file replaces:
//   - "A second insertion numbers sequentially and appends its definition
//     right below the first"
//   - "Caret mid-'clause' (just before the comma): the reference lands
//     AFTER the comma"
//   - "Every one of the nine lands OUTSIDE the closing mark and after the
//     full stop" (the quote / bracket / emphasis list)
//   - "The link case lands after the whole (url), never between ']' and
//     '('; the wikilink case lands after ']]'"
//   - "Numbered hotkey mid-'bravo': the reference lands exactly at the
//     caret, mid-word" (insert at end of word OFF)
//   - "Same for the named and inline hotkeys" (insert at end of word OFF)
//
// Everything here uses the sheet's own fixture text, so a failure reads
// the same way the sheet did.

// The plugin double the sheet describes: default settings with the popup
// turned off, because the retired sheet said "popup OFF (the popup is sheet 02)".
// `insertAtEndOfWord` is the one knob these tests vary.
function plugin(doc: FakeEditor, insertAtEndOfWord: boolean): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord,
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

// A note plus a caret. `words` is on because the main editor's end-of-word
// hop asks the editor for the word under the cursor, and the fake only
// offers that method when the test says it may be used.
function noteWithCaret(lines: string[], line: number, ch: number): FakeEditor {
    return sharedFakeEditor(lines, {
        cursor: { line, ch },
        edits: true,
        wholeDoc: true,
        words: true,
    });
}

describe("a second insertion numbers on from the first", () => {
    // The sheet's own note: a sentence to insert into, a reference that is
    // already there, and its definition at the bottom.
    const note = () => [
        "Insert into this sentence.",
        "",
        "The third uses the existing reference here[^1] and its definition at the bottom.",
        "",
        "[^1]: the existing definition",
    ];

    it("the first press lands its definition right below the existing one", async () => {
        const doc = noteWithCaret(note(), 0, 9); // mid "into"
        await insertAutonumFootnote(plugin(doc, true));
        expect(doc.lines[0]).toBe("Insert into[^2] this sentence.");
        expect(doc.lines.at(-2)).toBe("[^1]: the existing definition");
        expect(doc.lines.at(-1)).toBe("[^2]: ");
    });

    it("a second press numbers on and stacks its definition under the first", async () => {
        const doc = noteWithCaret(note(), 0, 9); // mid "into"
        await insertAutonumFootnote(plugin(doc, true));
        // the caret for the second press: mid "sentence", further along the
        // same line
        doc.setCursor({ line: 0, ch: doc.lines[0].indexOf("sentence") + 3 });
        await insertAutonumFootnote(plugin(doc, true));
        expect(doc.lines[0]).toBe("Insert into[^2] this sentence.[^3]");
        expect(doc.lines.slice(-3)).toEqual([
            "[^1]: the existing definition",
            "[^2]: ",
            "[^3]: ",
        ]);
    });
});

describe("insert at end of word ON", () => {
    // the sheet's fixture line for this section
    const fixture = "Alpha bravo charlie, end of clause, then more words. 另一句中文。";

    it("a caret mid-'clause', just before the comma, lands the reference after the comma", async () => {
        const doc = noteWithCaret([fixture], 0, fixture.indexOf("clause") + 3);
        await insertAutonumFootnote(plugin(doc, true));
        expect(doc.lines[0]).toBe(
            "Alpha bravo charlie, end of clause,[^1] then more words. 另一句中文。",
        );
    });
});

// The closing-mark convention Jason reported on 2026-09-09: a note number
// follows the closing quotation mark or bracket AND the punctuation after
// it, which is the Chicago Manual of Style's rule. The sheet listed nine
// shapes and asked for a press mid-"bravo" in each.
describe("the nine closing marks", () => {
    const shapes: [string, string][] = [
        ['This is "some bravo".', 'This is "some bravo".[^1]'],
        ["This is 'some bravo'.", "This is 'some bravo'.[^1]"],
        ["This is (some bravo).", "This is (some bravo).[^1]"],
        ["This is [some bravo].", "This is [some bravo].[^1]"],
        ["This is {some bravo}.", "This is {some bravo}.[^1]"],
        ["This is **some bravo**.", "This is **some bravo**.[^1]"],
        ["This is *some bravo*.", "This is *some bravo*.[^1]"],
        ["This is ==some bravo==.", "This is ==some bravo==.[^1]"],
        ["This is ~~some bravo~~.", "This is ~~some bravo~~.[^1]"],
    ];

    for (const [line, expected] of shapes) {
        it(`lands outside the closing mark and after the full stop: ${line}`, async () => {
            const doc = noteWithCaret([line], 0, line.indexOf("bravo") + 2);
            await insertAutonumFootnote(plugin(doc, true));
            expect(doc.lines[0]).toBe(expected);
        });
    }
});

describe("links and wikilinks", () => {
    it("a markdown link takes the reference after the whole (url), never between ']' and '('", async () => {
        const line = "A link: see [some bravo](https://theindex.moe) here.";
        const doc = noteWithCaret([line], 0, line.indexOf("bravo") + 2);
        await insertAutonumFootnote(plugin(doc, true));
        expect(doc.lines[0]).toBe(
            "A link: see [some bravo](https://theindex.moe)[^1] here.",
        );
    });

    it("a wikilink takes the reference after the closing ']]'", async () => {
        const line = "A wikilink: [[some bravo]].";
        const doc = noteWithCaret([line], 0, line.indexOf("bravo") + 2);
        await insertAutonumFootnote(plugin(doc, true));
        expect(doc.lines[0]).toBe("A wikilink: [[some bravo]].[^1]");
    });
});

describe("insert at end of word OFF", () => {
    // "Alpha br|avo charlie": the caret sits in the middle of "bravo"
    const fixture = "Alpha bravo charlie";
    const midBravo = 8;

    it("the numbered hotkey lands the reference exactly at the caret", async () => {
        const doc = noteWithCaret([fixture], 0, midBravo);
        await insertAutonumFootnote(plugin(doc, false));
        expect(doc.lines).toEqual(["Alpha br[^1]avo charlie", "", "[^1]: "]);
    });

    it("the named hotkey leaves its empty '[^]' at the caret, with the caret between the brackets", async () => {
        const doc = noteWithCaret([fixture], 0, midBravo);
        await insertNamedFootnote(plugin(doc, false));
        expect(doc.lines).toEqual(["Alpha br[^]avo charlie"]);
        expect(doc.cursor).toEqual({ line: 0, ch: midBravo + 2 });
    });

    it("the inline hotkey leaves its empty '^[]' at the caret, with the caret between the brackets", async () => {
        const doc = noteWithCaret([fixture], 0, midBravo);
        await insertInlineFootnote(plugin(doc, false));
        expect(doc.lines).toEqual(["Alpha br^[]avo charlie"]);
        expect(doc.cursor).toEqual({ line: 0, ch: midBravo + 2 });
    });
});
