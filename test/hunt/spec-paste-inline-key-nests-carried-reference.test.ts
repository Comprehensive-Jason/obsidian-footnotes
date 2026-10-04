import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { pasteInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// spec question: should "Paste as inline footnote" refuse, or strip the
// references, when the clipboard text holds a reference?
//
// What it does now: with "a[^1] b" in the clipboard, the paste key gives
// "x^[a[^1] b ...]", a live reference inside an inline footnote, so one
// footnote is nested in another. With several carets it does this at
// every caret. This predates 0.3.0 for a plain "a[^1] b" clipboard; since
// 0.3.0 a copy carries the definition too, which makes the shape common.
// What a user might expect: the plugin prevents nesting everywhere else,
// so either the paste is refused with a toast, or the reference is left
// out of the inline footnote.
// Why it is a question and not a bug: the clipboard is the user's own
// text, and ADR 0001 says hand-typed nesting is "surfaced by lint, never"
// destroyed. Whether pasting it into a footnote counts as the plugin
// creating nesting is Jason's call, the same question as
// spec-carry-paste-nests-footnote. The definition label being flattened
// into the text is pinned separately as a bug,
// bug-paste-inline-key-spills-definition-label.
//
// Hunt 2026-10-02, round 2, lens interactions. Cluster I3 (the nesting
// half).
//
// Source of truth: docs/adr/0001-no-nested-footnotes.md ("We refuse to
// create nesting anywhere") and CONTEXT.md's Nested footnote entry.

// Makes navigator.clipboard.readText hand back `text`.
function stubClipboard(text: string) {
    vi.stubGlobal("navigator", { clipboard: { readText: () => Promise.resolve(text) } });
}

// The names of the references that sit inside an inline footnote's
// brackets, on any line: the note reading lists them as not live, since
// Obsidian reads them as the inline footnote's text (rule E3).
function nestedReferences(lines: string[]): string[] {
    return readNote(lines)
        .references.filter((reference) => !reference.live)
        .map((reference) => reference.name);
}

const base = {
    carryFootnotesOnCopy: true,
    enablePopupEditor: false,
    insertAtEndOfWord: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("spec question: the paste-as-inline key with a reference in the clipboard", () => {
    it.fails("does not nest a reference inside the new inline footnote", async () => {
        stubClipboard("a[^1] b\n\n[^1]: one");
        const doc = fakeEditor(["x"], { wholeDoc: true, edits: true, cursor: { line: 0, ch: 1 } });
        await pasteInlineFootnote(fakePlugin({ ...base }, doc));
        expect(nestedReferences(doc.lines)).toEqual([]);
    });

    it.fails("multi-caret paste-as-inline with the same clipboard does not nest either", async () => {
        stubClipboard("a[^1] b\n\n[^1]: one");
        const doc = fakeEditor(["x y"], { wholeDoc: true, edits: true, carets: [{ line: 0, ch: 1 }, { line: 0, ch: 3 }] });
        await pasteInlineFootnote(fakePlugin({ ...base }, doc));
        expect(nestedReferences(doc.lines)).toEqual([]);
    });
});
