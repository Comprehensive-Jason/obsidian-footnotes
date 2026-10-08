import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { absorbLeadingSpace } from "../../src/commands/selection-footnote";
import { InsideLinkNotice } from "../../src/editor/notice";
import { readNote } from "../../src/parsing/note-reading";

// spec question: when the user selects the words right after bracketed
// text or a bare web address and presses the numbered or named key, should
// the plugin keep the space in front of the new reference, so the
// selection converts?
//
// What it did before the ruling: in "Smith [2020] argues this.", select "argues this."
// and press the numbered or named key; in "Read https://example.com
// today.", select "today." and press the numbered key. Each is refused
// with "No footnote was created: Obsidian would read it as part of a
// link." The plugin takes the space in front of the selection along with
// it, so the reference would be glued to the "]" ("Smith [2020][^1]") or
// to the address ("https://example.com[^1]"). Glued after the "]", the
// reference is a reference link to Obsidian, and dead; glued to a bare
// address, the address takes it in. The result gate sees that and
// refuses. Nothing the user selected is a link, and the inline key
// converts the same selection ("Smith [2020]^[argues this.]").
// What a user might expect: the selection becomes a footnote, as any other
// selection of plain prose does.
//
// The options, recommended first:
// (a) Keep the space only where taking it would make the reference dead:
// "Smith [2020] [^1]" and "Read https://example.com [^1]". Recommended: it
// converts what the user selected, and the reference stays live.
// (b) Keep refusing, with a notice that names the cause (the bracket or
// the address right before the selection).
// (c) Leave it as it is.
// The tests below assert (a) for the numbered key on both shapes, and only
// that the named key is not refused with the link notice.
//
// Why it is a question and not a bug: taking the space is Jason's ruling
// (2026-09-08, commit aa25d9e: a reference never has a space before it),
// and the refusal is the result gate doing its job on the text that
// ruling writes. Which of the two gives way here is a product decision.
//
// Hunt 2026-10-08, cycle 6. Cluster Z10, triage question Q26.
//
// Answered (Jason's ruling Q26, 2026-10-08), option (a): the space before
// the new reference stays only where dropping it would make the reference
// dead; everywhere else it is still dropped (the 2026-09-08 ruling). The
// tests below were it.fails until then; what the press did before is
// described above.
//
// Origin: pre-existing for the numbered key. The named key's refusal
// comes before its name dialog since 99d4e6d, where the gate started
// asking under the next free number.
//
// Source of truth: docs/obsidian-reading-rules.md D7 (a reference glued
// after the "]" of bracketed text is dead; one with a space in front is
// not glued); the settled fact that a bare address swallows a reference
// glued to it; README, "Turn selected text into a footnote" (its list of
// refusals holds nothing like this); absorbLeadingSpace in
// src/commands/selection-footnote.ts.

const Settings = {
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

/** Selects `selected` in the one-line note `line`, presses `key`, and returns the editor. */
async function convert(line: string, selected: string, key = insertAutonumFootnote) {
    const from = line.indexOf(selected);
    const to = from + selected.length;
    const doc = fakeEditor([line], { cursor: { line: 0, ch: to }, selection: { anchor: { line: 0, ch: from }, head: { line: 0, ch: to } }, edits: true, wholeDoc: true, words: true });
    await key(fakePlugin(Settings, doc));
    return doc;
}

beforeEach(resetNotices);

describe("a selection right after bracketed text", () => {
    it("control: the inline key converts it", async () => {
        const doc = await convert("Smith [2020] argues this.", "argues this.", insertInlineFootnote);
        expect(doc.lines).toEqual(["Smith [2020]^[argues this.]"]);
        expect(messages()).toEqual([]);
    });

    it("control: with a space in front, the reference after the bracket is live to the plugin's reader", () => {
        expect(readNote(["Smith [2020] [^1]", "", "[^1]: argues this."]).referencesOn(0).map((r) => r.name)).toEqual(["1"]);
    });

    // Before the ruling: refused with the link notice, and the note unchanged.
    it("spec (a): the numbered key converts it and keeps the space in front of the reference", async () => {
        const doc = await convert("Smith [2020] argues this.", "argues this.");
        expect(messages()).toEqual([]);
        expect(doc.lines[0]).toBe("Smith [2020] [^1]");
        expect(doc.lines.at(-1)).toBe("[^1]: argues this.");
    });

    // Before the ruling: refused with the link notice before the name dialog opened.
    it("spec: the named key is not refused with the link notice", async () => {
        await convert("He was right [sic] about it.", "about it.", insertNamedFootnote);
        expect(messages()).not.toContain(InsideLinkNotice);
    });
});

describe("a selection right after a bare web address", () => {
    it("control: the numbered key converts a selection after a wikilink, the space taken", async () => {
        const doc = await convert("Read [[Notes]] today.", "today.");
        expect(doc.lines[0]).toBe("Read [[Notes]][^1]");
        expect(messages()).toEqual([]);
    });

    it("control: with a space in front, the reference after the address is live to the plugin's reader", () => {
        expect(readNote(["Read https://example.com [^1]", "", "[^1]: today."]).referencesOn(0).map((r) => r.name)).toEqual(["1"]);
    });

    // Before the ruling: refused with the link notice, and the note unchanged.
    it("spec (a): the numbered key converts it and keeps the space in front of the reference", async () => {
        const doc = await convert("Read https://example.com today.", "today.");
        expect(messages()).toEqual([]);
        expect(doc.lines[0]).toBe("Read https://example.com [^1]");
        expect(doc.lines.at(-1)).toBe("[^1]: today.");
    });
});

describe("the space in front of the new reference (absorbLeadingSpace)", () => {
    it("stays after bracketed text and a bare web address, where a glued reference would be dead", () => {
        expect(absorbLeadingSpace("Smith [2020] argues this.", 13, 0)).toBe(13);
        expect(absorbLeadingSpace("Read https://example.com today.", 25, 0)).toBe(25);
    });

    it("control: goes after plain prose, a wikilink, and a link, as the 2026-09-08 ruling has it", () => {
        expect(absorbLeadingSpace("range. The buoy log", 7, 0)).toBe(6);
        expect(absorbLeadingSpace("Read [[Notes]] today.", 15, 0)).toBe(14);
        expect(absorbLeadingSpace("Read [the log](https://example.com) today.", 36, 0)).toBe(35);
    });

    it("control: goes in front of an inline footnote, which is read before the link", () => {
        expect(absorbLeadingSpace("Smith [2020] argues this.", 13, 0, false)).toBe(12);
    });
});
