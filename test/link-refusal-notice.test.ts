import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "./helpers/notices";
import { fakeEditor } from "./helpers/fake-editor";
import { fakePlugin } from "./helpers/fake-plugin";

import FootnotePlugin from "../src/main";
import {
    insertAutonumFootnote,
    insertInlineFootnote,
    insertNamedFootnote,
} from "../src/commands/insert-or-navigate-footnotes";
import { InsideLinkNotice } from "../src/editor/notice";
import { ProtectedCreationNotice, verifyLiveFootnoteInsertion } from "../src/editor/insertion-liveness";
import { readNote } from "../src/parsing/note-reading";

// A press refused because Obsidian would read the new reference as part of
// a link says so in its own words (Jason's ruling, 2026-10-04).
//
// The shapes: the caret on the last word of "[sic]" or "[text]", with
// "insert at end of word" on, puts the reference straight after the "]".
// Obsidian reads "[sic][^1]" and "[text][^1]" as a reference link with the
// label "^1", whatever the note defines, and shows no footnote there (live
// answers swap34:br-sic-defined, swap34:br-sic-undefined, and
// swap34:br-defined-label in test/obsidian-answers/swap34-probes.json). The
// born-dead check refuses that press. Before this ruling the refusal
// borrowed the protected-text notice ("footnotes can't go inside code,
// math, or other protected text"), which names the wrong cause; that
// notice stays for code, math, comments, and other protected text.

const Settings: Partial<FootnotePlugin["settings"]> = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

type Press = (plugin: FootnotePlugin) => Promise<void>;

/** Presses `press` with one caret at column `ch` of line 0, and returns the editor. */
async function pressOnce(press: Press, lines: string[], ch: number) {
    const doc = fakeEditor(lines, { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await press(fakePlugin(Settings, doc));
    return doc;
}

/** Presses `press` with a caret at each of `chs` on line 0, and returns the editor. */
async function pressAtCarets(press: Press, lines: string[], chs: number[]) {
    const doc = fakeEditor(lines, { carets: chs.map((ch) => ({ line: 0, ch })), edits: true, wholeDoc: true, words: true });
    await press(fakePlugin(Settings, doc));
    return doc;
}

beforeEach(() => {
    resetNotices();
});

// Each note, with the caret's column inside the bracketed word.
const Shapes = [
    { shape: "a bare [sic]", lines: ["see [sic] now"], ch: 6 },
    { shape: "a shortcut reference link [text]", lines: ["see [text] now", "", "[text]: http://u"], ch: 6 },
];

describe.each(Shapes)("a press on the last word of $shape", ({ lines, ch }) => {
    it("the numbered key refuses with the link notice", async () => {
        const doc = await pressOnce(insertAutonumFootnote, lines, ch);
        expect(doc.lines).toEqual(lines);
        expect(messages()).toEqual([InsideLinkNotice]);
    });

    it("the named key refuses with the link notice", async () => {
        // the named key writes the empty "[^]" first, and "[sic][^]" is a
        // reference link to Obsidian too, so the name typed into it would
        // never make a footnote
        const doc = await pressOnce(insertNamedFootnote, lines, ch);
        expect(doc.lines).toEqual(lines);
        expect(messages()).toEqual([InsideLinkNotice]);
    });

    it("the numbered key at two carets refuses the whole press with the link notice", async () => {
        const twoCarets = [lines[0] + " and plain", ...lines.slice(1)];
        const doc = await pressAtCarets(insertAutonumFootnote, twoCarets, [ch, lines[0].length + 3]);
        expect(doc.lines).toEqual(twoCarets);
        expect(messages()).toEqual([InsideLinkNotice]);
    });

    it("the named key at two carets refuses the whole press with the link notice", async () => {
        const twoCarets = [lines[0] + " and plain", ...lines.slice(1)];
        const doc = await pressAtCarets(insertNamedFootnote, twoCarets, [ch, lines[0].length + 3]);
        expect(doc.lines).toEqual(twoCarets);
        expect(messages()).toEqual([InsideLinkNotice]);
    });

    // Characterization (behaviour pinned as it is, for Jason's review): the
    // inline key is not refused here. "[sic]^[]" reads as the link (or the
    // bracketed word) followed by a whole inline footnote, since "^[" opens
    // no link label, so the footnote is live and the press writes it.
    it("the inline key writes its inline footnote after the brackets, with no notice", async () => {
        const doc = await pressOnce(insertInlineFootnote, lines, ch);
        const close = lines[0].indexOf("]") + 1;
        expect(doc.lines[0]).toBe(lines[0].slice(0, close) + "^[]" + lines[0].slice(close));
        expect(messages()).toEqual([]);
    });
});

describe("protected text keeps the protected-text notice", () => {
    it("the numbered key in inline code", async () => {
        const lines = ["see `code` now"];
        const doc = await pressOnce(insertAutonumFootnote, lines, 7);
        expect(doc.lines).toEqual(lines);
        expect(messages()).toEqual([ProtectedCreationNotice]);
    });

    it("the numbered key at two carets, one of them in inline code", async () => {
        const lines = ["see `code` now and plain"];
        const doc = await pressAtCarets(insertAutonumFootnote, lines, [7, 17]);
        expect(doc.lines).toEqual(lines);
        expect(messages()).toEqual([ProtectedCreationNotice]);
    });

    it("the numbered key whose reference would close a math pair", async () => {
        // "$5 x$" is no math (a space before the closing "$"), but with the
        // reference in, "$5 x[^1]$" is: the born-dead check refuses, and
        // the cause is math, not a link
        const lines = ["costs $5 x$ now"];
        const doc = await pressOnce(insertAutonumFootnote, lines, 10);
        expect(doc.lines).toEqual(lines);
        expect(messages()).toEqual([ProtectedCreationNotice]);
    });
});

describe("the note reading says where a link is", () => {
    it("a reference link runs from its first '[' through its label's ']'", () => {
        const reading = readNote(["see [sic][^1] now"]);
        expect(reading.insideLink(0, 3)).toBe(false);
        expect(reading.insideLink(0, 4)).toBe(true);
        expect(reading.insideLink(0, 9)).toBe(true);
        expect(reading.insideLink(0, 12)).toBe(true);
        expect(reading.insideLink(0, 13)).toBe(false);
    });

    it("an inline link, an image, and a wikilink are links; a live reference beside them is not inside one", () => {
        const reading = readNote(["[a](u)[^1] ![b](v) [[c]]"]);
        expect(reading.insideLink(0, 0)).toBe(true);
        expect(reading.insideLink(0, 6)).toBe(false);
        expect(reading.insideLink(0, 11)).toBe(true);
        expect(reading.insideLink(0, 19)).toBe(true);
    });

    it("a link over two lines takes in the start of its second line", () => {
        const reading = readNote(["see [two", "lines](u) now"]);
        expect(reading.insideLink(0, 4)).toBe(true);
        expect(reading.insideLink(1, 0)).toBe(true);
        expect(reading.insideLink(1, 10)).toBe(false);
    });
});

describe("the born-dead verdict names a link as its own cause", () => {
    it("a reference read as a reference link's label is 'link'", () => {
        expect(
            verifyLiveFootnoteInsertion({
                before: readNote(["see [sic] now"]),
                lines: ["see [sic][^1] now", "", "[^1]: "],
                anchors: [{ line: 0, ch: 9 }],
                footnoteId: "1",
                definitionLabelLine: 2,
            }),
        ).toBe("link");
    });

    it("a reference read as code is 'dead'", () => {
        expect(
            verifyLiveFootnoteInsertion({
                before: readNote(["see `sic` now"]),
                lines: ["see `sic[^1]` now", "", "[^1]: "],
                anchors: [{ line: 0, ch: 8 }],
                footnoteId: "1",
                definitionLabelLine: 2,
            }),
        ).toBe("dead");
    });
});
