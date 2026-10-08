import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";

// spec question: Delete footnote everywhere on a footnote whose only
// reference stands alone on a line between two lines of a paragraph:
// should it delete the reference and take the emptied line out too?
//
// What it does now: "The tide rose." and "Oysters closed." with a blank
// line between them. A press on the blank line writes "[^1]" there, which
// is allowed (Jason's ruling B1, 2026-10-08: the line joins the two into
// one paragraph of three lines). Delete footnote everywhere on [^1] then
// says "Nothing was deleted: removing "[^1]" would change how Obsidian
// reads the text around it. Delete it by hand." Cutting the reference
// alone leaves an empty line, which splits the paragraph in two, so the
// result gate refuses.
// What a user might expect: the footnote deleted, as the command does
// everywhere else.
//
// The options, recommended first:
// (a) Delete it and remove the emptied line, so "The tide rose." and
// "Oysters closed." read as one paragraph, as they already do with the
// reference between them. Recommended: the note reads exactly as it does
// now, and the gate passes it.
// (b) Keep refusing.
// The test below asserts (a).
//
// Why it is a question and not a bug: the refusal is the gate keeping the
// promise the README makes (a deletion that would change how Obsidian
// reads the text around it is refused rather than half done). Whether the
// command should take the emptied line with it, a step it takes nowhere
// else, is Jason's call.
//
// Hunt 2026-10-08, cycle 6. Cluster Z13, triage question Q28.
//
// Origin: pre-existing.
//
// Source of truth: docs/obsidian-reading-rules.md G1 (live answer
// gs3:b1-prose: "The tide rose.\n[^1]\nOysters closed." is one paragraph
// of three lines); README, "Deleting a footnote"; the contract of
// deleteFootnoteEverywhere in src/commands/delete-footnote.ts ("every live
// reference to it cut out of the text with the gap closed").

const Settings = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);

describe("Delete footnote everywhere on a reference alone on a paragraph's line", () => {
    it("control: a press on the blank line between two paragraphs writes the reference there", async () => {
        const doc = fakeEditor(["The tide rose.", "", "Oysters closed."], { cursor: { line: 1, ch: 0 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(Settings, doc));
        expect(doc.lines).toEqual(["The tide rose.", "[^1]", "Oysters closed.", "", "[^1]: "]);
        expect(messages()).toEqual([]);
    });

    it("control: a reference at the end of a paragraph's line is deleted", () => {
        const plan = deleteFootnoteEverywhere(["The tide rose[^1].", "Oysters closed.", "", "[^1]: Tide tables."].join("\n"), "1");
        expect(plan).toEqual({ kind: "deleted", markdown: "The tide rose.\nOysters closed.", references: 1, definitions: 1 });
    });

    // Now: { kind: "refused" }, with the "Delete it by hand." reason.
    it.fails("spec (a): it is deleted, and the emptied line goes with it", () => {
        const plan = deleteFootnoteEverywhere(["The tide rose.", "[^1]", "Oysters closed.", "", "[^1]: Tide tables."].join("\n"), "1");
        expect(plan).toEqual({ kind: "deleted", markdown: "The tide rose.\nOysters closed.", references: 1, definitions: 1 });
    });
});
