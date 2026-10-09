// spec question Q34 (cluster V8): a cut from the end of a bullet into a
// two-line paragraph under the list is refused. Should it go through as the
// editor's own cut does?
//
// What it does now: "- First point[^1] made" / "" / "The next paragraph
// goes on" / "over two lines." with "[^1]: Smith 2020." The user drags from
// after "- First" to after "The next" and presses Ctrl+X. Nothing is cut:
// "Nothing was cut: it would change how Obsidian reads the text around it."
// With a one-line paragraph under the list the same cut goes through, and
// without the footnote it is the editor's own cut.
// Options: (a) go through as the editor does: "- First paragraph goes on" /
// "over two lines." (live: one bullet "First paragraph goes on over two
// lines."), footnote 1 carried on the clipboard; (b) keep refusing (the
// second line becomes part of the bullet, a change the user may not see).
// This file asserts (a).
//
// Answered (Jason's ruling Q34, 2026-10-09), option (a): the cut goes
// through as the editor's own cut does, since every change in how the
// note reads comes from the user's own cut, and nothing is lost: "- First
// paragraph goes on" / "over two lines.", with footnote 1 on the
// clipboard. The spec test below was it.fails until then.
//
// Hunt 2026-10-09, cycle 8, lens the gate. Source: ADR 0003 (do what the
// editor would do); ruling B1. Same family as V7
// (bug-cut-first-line-of-item-with-more-under-it-refused).
// Origin: pre-existing (red at 34d5377 and 3a47f7a).

import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { NothingCutNotice } from "../../src/editor/notice";

// probe: cutting a list item that has a sub-item, when the item
// cites a footnote. A harder variant of cluster Z19 (pin
// bug-cut-first-line-of-block-refused): the line under the cut keeps its
// kind but changes its container (the sub-item comes up a level), which
// is what the editor's own cut does with the same selection.

type Pos = { line: number; ch: number };
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
function pluginIn(doc: FakeEditor): FootnotePlugin {
    const plugin = fakePlugin({ carryFootnotesOnCopy: true, lintOnFootnoteCreation: false }, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path: "note.md" } }), getLeavesOfType: () => [] };
    return plugin;
}
/** The note after a cut from `from` to `to`, the clipboard, and the caret; the editor's own cut when the plugin leaves it alone. */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: to, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(pluginIn(doc), event as never);
    if (!event.defaultPrevented) doc.transaction({ changes: [{ from, to, text: "" }], selection: { from } });
    return { lines: doc.lines.slice(), clip: event.written["text/plain"] ?? "", caret: doc.getCursor(), taken: event.defaultPrevented };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

// Spec question: a cut from the middle of a bullet into the middle of the
// paragraph under the list, when the cut text cites a footnote. The
// editor's own cut joins the rest of the paragraph to the bullet, its
// second line coming along as the bullet's lazy text; the plugin refuses
// with "Nothing was cut". The same cut with no footnote in it is the
// editor's own.
describe("a cut from a bullet into the paragraph under the list", () => {
    it("control: with a one-line paragraph under the list, the cut goes through", () => {
        const before = ["- First point[^1] made", "", "The next paragraph goes on.", "", "[^1]: Smith 2020."];
        const c = cut(before, { line: 0, ch: 7 }, { line: 2, ch: 8 });
        expect(messages()).not.toContain(NothingCutNotice);
        expect(c.lines[0]).toBe("- First paragraph goes on.");
    });
    it("ruling Q34: with a two-line paragraph under the list, the cut goes through as the editor's does", () => {
        const before = ["- First point[^1] made", "", "The next paragraph goes on", "over two lines.", "", "[^1]: Smith 2020."];
        const c = cut(before, { line: 0, ch: 7 }, { line: 2, ch: 8 });
        expect(messages()).not.toContain(NothingCutNotice);
        expect(c.taken).toBe(true);
        expect(c.lines).toEqual(["- First paragraph goes on", "over two lines."]);
        expect(c.clip).toContain("[^1]: Smith 2020.");
    });
    it("ruling Q34: a three-line paragraph comes along whole", () => {
        const before = ["- First point[^1] made", "", "The next paragraph goes on", "over three", "lines.", "", "[^1]: Smith 2020."];
        const c = cut(before, { line: 0, ch: 7 }, { line: 2, ch: 8 });
        expect(messages()).not.toContain(NothingCutNotice);
        expect(c.lines).toEqual(["- First paragraph goes on", "over three", "lines."]);
    });
    it("ruling Q34: the same from a quote's line, the paragraph's second line coming into the quote", () => {
        const before = ["> A quote[^1] here", "", "The next paragraph goes on", "over two lines.", "", "[^1]: Smith 2020."];
        const c = cut(before, { line: 0, ch: 9 }, { line: 2, ch: 8 });
        expect(messages()).not.toContain(NothingCutNotice);
        expect(c.lines).toEqual(["> A quote paragraph goes on", "over two lines."]);
    });
});

