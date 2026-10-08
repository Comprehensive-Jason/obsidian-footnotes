import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): a cut of whole lines right next to a definition that
// sits between two lists takes the definition along, and the two lists
// join into one.
//
// What the user would see: "- a", "- b", a blank line, "[^1]: one", a
// blank line, then "- c[^1]" and "- d". They cut the line "- c[^1]" with
// Shift+Down and Ctrl+X. The plugin takes "[^1]: one" out with it, since
// nothing references this footnote any more, and leaves "- a", "- b", a
// blank line, "- d": Reading view now draws one loose list of three
// where there were two lists. In a numbered note, "2. d" becomes item 3
// of the first list. The same happens when the line cut is a paragraph
// "Then[^1]:" just above the second list: "- c" and "- d" join "- a" and
// "- b" in one loose list of four, and the notice says "Cut with 1
// footnote definition that nothing else used". Pasting the cut back
// gives the note back.
//
// A "definition" is the "[^1]: one" entry that holds a footnote's text.
// A list is "loose" when a blank line sits between two of its items, which
// draws every item with the wider spacing of a paragraph.
//
// Hunt 2026-10-08, cycle 7. Cluster Y4 (Y5 merged into it).
//
// Origin: two faces with two histories. The "Then[^1]:" paragraph cut is a
// regression from e17bb02 (the start-mark leeway next to the user's own
// text); it worked at fb8c78b. The list-item cut and its numbered twin are
// pre-existing at 97abeac, a regression of Q2's fix from 24ef25f; they
// worked at 3145b1e and at 24ef25f~1.
//
// Source of truth: docs/obsidian-reading-rules.md B9 (two lists with only
// blank lines between them are one list; anything else between them, a
// footnote definition included, keeps them apart; saved answers h2:cn2-*)
// and B10 (a blank line between two items makes the whole list loose).
// Jason's triage decision Q2 (2026-10-05): a cut leaves such a definition
// in the note, and the clipboard still carries it (pin
// bug-cut-definition-between-lists-joins-them, which only cuts a line
// outside the lists). planCut's own comment promises the definition stays
// when taking it changes how other lines read.
//
// Cause: planCut in src/commands/carry-footnotes.ts asks the result gate
// (the one check every edit passes before it is written) whether taking
// the definition out with the cut changes how the note reads, and keeps
// the definition when it does. The gate's check 5 compares each line's
// blocks before and after, with a mark on the line that starts a list. In
// the list-item cut, "- c[^1]" was the only line that carried the second
// list's start mark, and it is gone; "- d" was a plain item before and is
// a plain item after, so nothing it compares has changed. In the
// paragraph cut, "- c" did start the second list, but it sits next to the
// user's cut text, where e17bb02 lets a line lose or gain its start mark
// (so a cut of a list's first item is not refused), and the join passes
// as that.

/** A stand-in for the browser's clipboard event: what was written, and whether the editor's own action was stopped. */
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
/** A plugin with carrying on, whose active note is `doc`. */
function pluginIn(doc: FakeEditor): FootnotePlugin {
    const plugin = fakePlugin({ carryFootnotesOnCopy: true, lintOnFootnoteCreation: false }, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path: "note.md" } }), getLeavesOfType: () => [] };
    return plugin;
}
/** The note after a cut of the text from `from` to `to`, what the cut put on the clipboard, and where it left the caret. When the plugin leaves the cut alone, the editor's own cut takes the text. */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: to, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(pluginIn(doc), event as never);
    if (!event.defaultPrevented) doc.transaction({ changes: [{ from, to, text: "" }] });
    return { lines: doc.lines.slice(), clip: event.written["text/plain"] ?? "", caret: doc.getCursor() };
}
/** The note after pasting `text` at `at`; when the plugin leaves the paste alone, the editor's own paste writes the text as it is. */
function paste(lines: string[], at: Pos, text: string) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    const taken = handlePaste(pluginIn(doc), clipboardEvent(text) as never, doc);
    if (!taken) doc.transaction({ changes: [{ from: at, to: at, text }] });
    return doc.lines.slice();
}
/** How many top-level lists the note draws outside definitions: the lines that start one in the plugin's reading. */
function listStarts(lines: string[]): number {
    const reading = readNote(lines);
    return lines.filter((_, i) => /^\^list(\.ordered)? /.test(reading.lineBlocks[i] ?? "")).length;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a cut next to a definition between two lists", () => {
    // Now: "- a", "- b", "", "- d", one loose list. The editor's own cut
    // would leave two lists; taking the definition too makes one.
    it.fails("cutting the second list's first item (Shift+Down) leaves the two lists apart", () => {
        const before = ["- a", "- b", "", "[^1]: one", "", "- c[^1]", "- d"];
        const c = cut(before, { line: 5, ch: 0 }, { line: 6, ch: 0 });
        expect(listStarts(c.lines), JSON.stringify(c.lines)).toBe(2);
    });

    // Now: "1. a", "2. b", "", "2. d", and Reading view numbers "d" 3.
    it.fails("numbered: cutting the second list's first item leaves the numbering alone", () => {
        const before = ["1. a", "2. b", "", "[^1]: one", "", "1. c[^1]", "2. d"];
        const c = cut(before, { line: 5, ch: 0 }, { line: 6, ch: 0 });
        expect(listStarts(c.lines), JSON.stringify(c.lines)).toBe(2);
    });

    it("control: cutting the first list's last item leaves the two lists apart", () => {
        const before = ["- a", "- b[^1]", "", "[^1]: one", "", "- c", "- d"];
        const c = cut(before, { line: 1, ch: 0 }, { line: 2, ch: 0 });
        expect(listStarts(c.lines), JSON.stringify(c.lines)).toBe(2);
    });

    // Now: "- a", "- b", "", "- c", "- d", one loose list of four, with
    // the notice "Cut with 1 footnote definition that nothing else used;
    // paste to carry it along."
    it.fails("cutting the paragraph above the second list leaves the lists apart", () => {
        const before = ["- a", "- b", "", "[^1]: one", "", "Then[^1]:", "- c", "- d"];
        const c = cut(before, { line: 5, ch: 0 }, { line: 6, ch: 0 });
        expect(listStarts(c.lines), JSON.stringify({ lines: c.lines, notices: messages() })).toBe(2);
    });

    it("control: cutting only the text of the second list's first item leaves the lists apart", () => {
        const before = ["- a", "- b", "", "[^1]: one", "", "- c[^1]", "- d"];
        const c = cut(before, { line: 5, ch: 2 }, { line: 5, ch: 7 });
        expect(listStarts(c.lines), JSON.stringify(c.lines)).toBe(2);
    });

    // A "paste back" is a paste of the plugin's own last cut at the caret
    // that cut left, which gives the note back as it was.
    it("control: the list-item cut pasted back gives the note back", () => {
        const before = ["- a", "- b", "", "[^1]: one", "", "- c[^1]", "- d"];
        const c = cut(before, { line: 5, ch: 0 }, { line: 6, ch: 0 });
        const back = paste(c.lines, c.caret, c.clip);
        expect(back, JSON.stringify({ cut: c.lines, back, notices: messages() })).toEqual(before);
    });
});
