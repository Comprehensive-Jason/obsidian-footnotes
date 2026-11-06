import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { lintFootnotes, LintOptions } from "../../src/linting/linter";
import { footnoteFacts } from "../../src/parsing/footnote-facts";
import { readNote } from "../../src/parsing/note-reading";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (data loss when Delete orphaned definitions is on, wrong output when it
// is off): an inline "<a ...>" tag that never closes changes how the rest of
// the note reads, and a long note read that change only as far as the end of
// the part holding the tag.
//
// What the user would see: a note imported from the web holds a heading like
// '## Results <a id="results"/>' or a line like 'Jump back to <a name="top">
// the top.'. Obsidian then reads no link and no bare address below it until a
// "</a>", so "[the report](Other.md)" shows as plain text. The plugin read a
// long note in parts, and each part started with the tag forgotten, so the
// same line read as a link or as plain text depending on where a part fell.
// A press in that line landed differently in a long note and a short one. And
// a reference glued to a bare address or to "[text]" reads as live in Obsidian
// here, but read as dead in a part, so with Delete orphaned definitions on, a
// lint deleted the definition it points at.
//
// Hunt 2026-11-06, cycle 9, finding H1. Severity: data loss, rare, needs the
// setting on. Origin: pre-existing, the package's parser has carried this state
// since the plugin started reading notes with it.
//
// Source of truth: the live answers H1a to H1g on Obsidian 1.15.0
// (work/c9/live-answers.json, live-answers-h1.json). H1a and H1b: an open tag
// or a self-closed one leaves a later "[the report](Other.md)" plain. H1c:
// a closed one keeps the link. H1d to H1g: a reference after a bare address,
// after "[text]", after plain words, and after a heading stays live.
//
// test/note-reading-parts.test.ts holds the reading in parts to the whole-note
// reading over many shapes. This file holds what the user sees from it.

const Settings = { insertAtEndOfWord: true, footnotePlacement: "after", enablePopupEditor: false, enableFootnotePrefix: false, enableFootnoteSectionHeading: false, footnoteSectionHeading: "", enableRemoveBlankLastLines: true, lintOnFootnoteCreation: false } as const;
const Fill = Array.from({ length: 300 }, (_, i) => [`Paragraph number ${i} of the note, with some words.`, ""]).flat();
const Target = "See [the report](http://example.com/report) here.";

const deleteOrphans: LintOptions = {
    fixPunctuation: false,
    fixLazyDefinitions: false,
    moveDefinitionsToBottom: false,
    reindex: false,
    reindexOptions: { renumberNamedFootnotes: false },
    removeOrphanedReferences: false,
    removeOrphanedDefinitions: true,
    mergeDuplicateDefinitions: false,
    orphanSafePrefix: "",
    applyNotePrefix: false,
    sectionHeading: "",
};

/** The text of the line holding "the report" after a press with the caret in that line's address, and the notices it raised. */
async function pressInAddress(lines: string[]) {
    resetNotices();
    const line = lines.indexOf(Target);
    const doc = fakeEditor(lines, { cursor: { line, ch: Target.indexOf("example") + 2 }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(Settings, doc));
    return { text: doc.lines.find((text) => text.includes("the report")), messages: messages().slice() };
}

beforeEach(() => { resetNotices(); });

describe("a note with an <a> tag left open reads the same short and long", () => {
    const Open = 'Jump back to <a name="top"> the top.';

    it("reads a later link as plain text, as Obsidian does (live answers H1a, H1b)", () => {
        for (const head of [Open, '## Results <a id="results"/>']) {
            const lines = [head, "", ...Fill, "See [the report](Other.md) here.", "", "See http://example.com/report too."];
            expect(readNote(lines).links.map((link) => link.lookup)).toEqual(["the report"]);
            expect(readNote(lines).protectedSpans.filter((span) => span.kind === "linkDestination")).toEqual([]);
        }
    });

    it("keeps a later link when the tag closed (live answer H1c)", () => {
        const lines = ['Jump <a name="top"> up</a> now.', "", ...Fill, "See [the report](Other.md) here."];
        expect(readNote(lines).links.map((link) => link.lookup)).toEqual([undefined]);
    });

    it.each([
        ["after a bare address (H1d)", "See http://example.com/report[^1] too."],
        ["after bracketed text (H1e)", "See [the report][^1] too."],
        ["after plain words (H1f)", "Plain words[^1] too."],
        ["under a heading, after unread link text (H1g)", "# A heading\n\nSee [link](u)[^1] too."],
    ])("reads a reference %s as live", (_, text) => {
        const lines = [Open, "", ...Fill, ...text.split("\n"), "", "[^1]: one"];
        const live = readNote(lines).references.filter((reference) => reference.live);
        expect(live.map((reference) => reference.name)).toEqual(["1"]);
        expect(live).toEqual(footnoteFacts(lines.join("\n")).references);
    });

    it.each(['## Results <a id="results"/>', Open, '- item <a id="q"/>', '| a <a id="q"/> |\n| - |', '[^9]: a source <a id="q"/>'])("a press in a later link's address lands the same in a short note and a long one: %s", async (head) => {
        const headLines = head.split("\n");
        const short = await pressInAddress([...headLines, "", Target]);
        const long = await pressInAddress([...headLines, "", ...Fill, Target]);
        expect(short.text).toBeDefined();
        expect(long).toEqual(short);
    });

    // Characterization: the short note's own result, pinned so a reviewer can
    // see it. The line reads as plain text here, so the press treats the
    // address as a word and nothing is a link to protect.
    it("a press lands in the address, which is plain text in such a note", async () => {
        const long = await pressInAddress([Open, "", ...Fill, Target]);
        expect(long.text).toBe("See [the report](http://example.com[^1]/report) here.");
    });

    it.each([
        ["after a bare address (H1d)", "See http://example.com/report[^1] too."],
        ["after bracketed text (H1e)", "See [the report][^1] too."],
    ])("with Delete orphaned definitions on, a lint keeps the definition of a reference %s", (_, text) => {
        const doc = [Open, "", ...Fill, text, "", "[^1]: one", ""].join("\n");
        expect(lintFootnotes(doc, deleteOrphans)).toContain("[^1]: one");
    });
});
