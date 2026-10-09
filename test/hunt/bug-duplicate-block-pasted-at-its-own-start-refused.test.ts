// BUG (wrong output): duplicating a block by pasting a copy at the block's
// own start, or cutting the first of two identical blocks, is refused.
//
// What the user would see: "Intro." / "" / "Water[^1]." / "" / "End." with
// "[^1]: x" below. They copy "Water[^1]." with the blank line under it
// (Shift+Down twice), put the caret at the start of "Water[^1].", and
// paste, to write a variant of the paragraph. Nothing is pasted: "Nothing
// was pasted: it would change how Obsidian reads the text around it." The
// same for a heading with its paragraph and for a callout. Cutting the
// first of two identical paragraphs is refused the same way. Pasting the
// copy one paragraph lower, or cutting the second copy, goes through.
//
// Hunt 2026-10-09, cycle 8. Cluster V9, lens carry.
// Source of truth: ADR 0003 (refuse only an edit that changes how the note
// reads beyond what the action meant); the editor's own paste and cut give
// the expected notes.
// Origin: a regression from 24ef25f (2026-10-08, the result gate deciding
// the cut and the carried paste), missed by cycles 6 and 7: green at
// 24ef25f's parent, red at 24ef25f, 34d5377, and 3a47f7a. The gate lines
// the two notes up from the top, so of two identical runs it takes the
// second for the new one while the paste declared the first.
// The "result gate" is the one check every edit passes before it is
// written: the note after must read the same as the note before, except
// for what the edit meant to change (ADR 0003).

import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { judgeEdit } from "../../src/editor/result-gate";

// Probe (hunt cycle 8). A cut or a carried paste of whole
// blocks that cite a footnote is refused when the text cut or pasted is
// exactly the same as the text right after it. The commonest face:
// duplicating a paragraph (or a callout, a table, a section) by copying it
// with its blank line (Shift+Down twice) and pasting it at its own start.
// "Nothing was pasted: it would change how Obsidian reads the text around
// it." The same paste at the start of the next paragraph goes through, and
// so does the editor's own paste of a paragraph with no footnote. The cut
// face: cutting the first of two identical paragraphs with its blank line.
//
// Cause (judgeEdit): check 1, "other", "[^1]". The gate lines up the
// notes before and after by their text, so of two identical runs it takes
// the second for the new one (or, for a cut, the second for the one taken
// out), while the action declared the first (insertedText or removedText).
// The reference in the run it takes for untouched then looks added or
// lost, and check 1 says an untouched footnote changed.
//
// Found by a move survey (kept in the scratch
// folder): at 5 seeds x 1500 runs, 396 duplicates pasted at their own
// start, 291 refused, every refusal check 1 (paragraphs 102, quotes and
// callouts 110, tables 79); the cut face once.
//
// Origin: pre-existing (red at 34d5377 and at 3a47f7a).

function clipboardEvent(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (type: string) => (type === "text/plain" ? text : ""),
            setData: (type: string, value: string) => {
                event.written[type] = value;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}
type Pos = { line: number; ch: number };
const settings = {
    carryFootnotesOnCopy: true,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "# Footnotes",
    removeEmptySectionHeading: false,
    lintOnFootnoteCreation: false,
    enableFootnotePrefix: false,
    enableRemoveBlankLastLines: false,
    footnotePlacement: "after" as const,
};
function pluginIn(doc: FakeEditor, path = "note.md"): FootnotePlugin {
    const plugin = fakePlugin(settings, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path } }), getLeavesOfType: () => [] };
    return plugin;
}
function sliceText(lines: string[], from: Pos, to: Pos): string {
    if (from.line === to.line) return lines[from.line].slice(from.ch, to.ch);
    return [lines[from.line].slice(from.ch), ...lines.slice(from.line + 1, to.line), lines[to.line].slice(0, to.ch)].join("\n");
}
function copy(lines: string[], from: Pos, to: Pos): string {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: to, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCopy(pluginIn(doc), event as never);
    if (!event.defaultPrevented) return sliceText(lines, from, to);
    return event.written["text/plain"] ?? "";
}
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: to, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(pluginIn(doc), event as never);
    if (!event.defaultPrevented) {
        const clip = sliceText(lines, from, to);
        doc.transaction({ changes: [{ from, to, text: "" }] });
        return { lines: doc.lines.slice(), clip, caret: from };
    }
    return { lines: doc.lines.slice(), clip: event.written["text/plain"] ?? "", caret: doc.getCursor() };
}
/** The note after pasting `text` at `at`; when the plugin leaves the paste alone, the editor's own paste writes the text as it is. */
function paste(lines: string[], at: Pos, text: string) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    const taken = handlePaste(pluginIn(doc), clipboardEvent(text) as never, doc);
    if (!taken) doc.transaction({ changes: [{ from: at, to: at, text }] });
    return doc.lines.slice();
}
const state = (x: unknown) => JSON.stringify({ x, notices: messages() });

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("duplicating a block by copying it and pasting it at its own start", () => {
    const note = ["Intro.", "", "Water[^1].", "", "End.", "", "[^1]: x"];
    const twice = ["Intro.", "", "Water[^1].", "", "Water[^1].", "", "End.", "", "[^1]: x"];

    // Now: refused, "Nothing was pasted: it would change how Obsidian reads the text around it."
    it.fails("a paragraph", () => {
        const clip = copy(note, { line: 2, ch: 0 }, { line: 4, ch: 0 });
        const out = paste(note, { line: 2, ch: 0 }, clip);
        expect(out, state({ clip, out })).toEqual(twice);
    });

    // Now: refused the same way.
    it.fails("a section: heading and paragraph", () => {
        const n = ["## Log", "", "Rain fell[^1].", "", "Sun shone.", "", "[^1]: x"];
        const clip = copy(n, { line: 0, ch: 0 }, { line: 4, ch: 0 });
        const out = paste(n, { line: 0, ch: 0 }, clip);
        expect(out, state({ clip, out })).toEqual(["## Log", "", "Rain fell[^1].", "", "## Log", "", "Rain fell[^1].", "", "Sun shone.", "", "[^1]: x"]);
    });

    // Now: refused the same way.
    it.fails("a callout", () => {
        const n = ["> [!quote] Source", "> Rain fell[^1].", "", "End.", "", "[^1]: x"];
        const clip = copy(n, { line: 0, ch: 0 }, { line: 3, ch: 0 });
        const out = paste(n, { line: 0, ch: 0 }, clip);
        expect(out, state({ clip, out })).toEqual(["> [!quote] Source", "> Rain fell[^1].", "", "> [!quote] Source", "> Rain fell[^1].", "", "End.", "", "[^1]: x"]);
    });

    it("control: the same copy pasted at the start of the next paragraph goes through", () => {
        const clip = copy(note, { line: 2, ch: 0 }, { line: 4, ch: 0 });
        const out = paste(note, { line: 4, ch: 0 }, clip);
        expect(out, state({ clip, out })).toEqual(twice);
    });

    it("control: the gate passes the same edit declared as the second copy, and refuses it declared as the first", () => {
        expect(judgeEdit(note, twice, { insertedText: [{ from: { line: 4, ch: 0 }, to: { line: 6, ch: 0 } }] }).pass).toBe(true);
        expect(judgeEdit(note, twice, { insertedText: [{ from: { line: 2, ch: 0 }, to: { line: 4, ch: 0 } }] })).toMatchObject({ pass: false, check: 1 });
    });
});

describe("cutting the first of two identical blocks", () => {
    // Now: refused, "Nothing was cut: it would change how Obsidian reads the text around it."
    it.fails("two identical paragraphs: cut the first with its blank line", () => {
        const n = ["Water[^1].", "", "Water[^1].", "", "End[^1].", "", "[^1]: x"];
        const c = cut(n, { line: 0, ch: 0 }, { line: 2, ch: 0 });
        expect(c.lines, state(c)).toEqual(["Water[^1].", "", "End[^1].", "", "[^1]: x"]);
    });

    it("control: cutting the second copy goes through", () => {
        const n = ["Water[^1].", "", "Water[^1].", "", "End[^1].", "", "[^1]: x"];
        const c = cut(n, { line: 2, ch: 0 }, { line: 4, ch: 0 });
        expect(c.lines, state(c)).toEqual(["Water[^1].", "", "End[^1].", "", "[^1]: x"]);
    });

    it("control: two paragraphs that differ: cut the first", () => {
        const n = ["Water[^1].", "", "Waves[^1].", "", "End[^1].", "", "[^1]: x"];
        const c = cut(n, { line: 0, ch: 0 }, { line: 2, ch: 0 });
        expect(c.lines, state(c)).toEqual(["Waves[^1].", "", "End[^1].", "", "[^1]: x"]);
    });
});
