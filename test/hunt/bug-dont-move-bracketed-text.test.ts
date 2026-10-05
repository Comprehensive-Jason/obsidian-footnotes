import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { InsideLinkNotice } from "../../src/editor/notice";
import type { FootnotePlacement } from "../../src/parsing/landing";
import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// bug: a press on a word inside bracketed text that is no link, such as
// "I said [some text] here", jumps past the "]" and is refused.
//
// Scenario: the caret inside "some", "insert at end of word" on, and any
// footnote placement. Jason noticed it under "Don't move" (footnotePlacement
// "none"), which steps over nothing (Jason's ruling, 2026-09-22).
//
// What it does now: the reference is put after the "]", where
// "[some text][^1]" reads as a reference link with the label "^1", so the
// born-dead check refuses the press with the link notice.
// What it should do: the reference lands at the end of the word, as it did
// before c6ee2fa: "I said [some[^1] text] here". Obsidian's Reading view
// shows that as plain bracketed text with a normal footnote (Jason,
// 2026-10-05: restore the old behaviour).
//
// Cause: since c6ee2fa, linkLikeEndAt (src/parsing/landing.ts) takes a
// construct's end from the reading's link facts, and remark-parse 8 reads
// any "[...]" as a reference link, whether or not a "[label]: url" line
// gives it an address. Only a reference link with a definition is drawn as
// a link; the rest is bracketed prose, which a reference may sit inside.
//
// Source of truth: Jason's ruling (2026-10-05) and CommonMark 0.31.2,
// section 6.3: a reference link needs a matching link reference
// definition, or it is plain text.
//
// Severity: a press that worked in 0.3.0-beta.4 is refused.

const Settings = (footnotePlacement: FootnotePlacement) => ({
    insertAtEndOfWord: true,
    footnotePlacement,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
});

/** Presses the numbered key with the caret at column `ch` of line 0, and returns the editor. */
async function press(lines: string[], ch: number, placement: FootnotePlacement) {
    const doc = fakeEditor(lines, { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(Settings(placement), doc));
    return doc;
}

const Line = "I said [some text] here";
// the caret between "so" and "me"
const InSome = Line.indexOf("some") + 2;

beforeEach(() => {
    resetNotices();
});

describe.each(["none", "after", "before"] as const)("bracketed text that is no link, placement %s", (placement) => {
    it("a caret inside the first word lands at the end of the word", async () => {
        const doc = await press([Line], InSome, placement);
        expect(doc.lines[0]).toBe("I said [some[^1] text] here");
        expect(messages()).toEqual([]);
    });

    it("an undefined full reference '[some text][ref]' is bracketed text too", async () => {
        const doc = await press(["I said [some text][ref] here"], InSome, placement);
        expect(doc.lines[0]).toBe("I said [some[^1] text][ref] here");
        expect(messages()).toEqual([]);
    });
});

describe("Don't move never steps past the ']' of bracketed text", () => {
    it("a caret inside the last word lands at the end of the word, inside the brackets", async () => {
        const doc = await press([Line], Line.indexOf("text") + 2, "none");
        expect(doc.lines[0]).toBe("I said [some text[^1]] here");
        expect(messages()).toEqual([]);
    });
});

describe("a real link is still never split (controls)", () => {
    it("a shortcut reference link with a definition: the press would break it, so it is refused", async () => {
        const lines = [Line, "", "[some text]: http://u"];
        const doc = await press(lines, InSome, "none");
        expect(doc.lines).toEqual(lines);
        expect(messages()).toEqual([InsideLinkNotice]);
    });

    it("a full reference link with a definition lands after the whole link", async () => {
        const lines = ["I said [some text][ref] here", "", "[ref]: http://u"];
        const doc = await press(lines, InSome, "none");
        expect(doc.lines[0]).toBe("I said [some text][ref][^1] here");
        expect(messages()).toEqual([]);
    });

    it("an inline link lands after its ')'", async () => {
        const doc = await press(["I said [some text](http://u) here"], InSome, "none");
        expect(doc.lines[0]).toBe("I said [some text](http://u)[^1] here");
        expect(messages()).toEqual([]);
    });
});
