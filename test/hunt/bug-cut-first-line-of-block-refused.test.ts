import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): cutting the first line of a list, quote, callout
// body, or paragraph that goes on below it is refused when that line cites
// a footnote.
//
// What the user would see: the note is "- a[^1]", "- b", "", "[^1]: one".
// They put the caret on "- a[^1]", press Shift+Down to select the line
// with its line break, and press Ctrl+X. Nothing is cut, and the notice
// says "Nothing was cut: it would change how Obsidian reads the text
// around it." The same happens to the first item of an ordered list or a
// task list, the first line of a quote or of a callout's body, the first
// line of a two-line paragraph, and the first item's text alone. Cutting
// the second item instead goes through, and so does the same cut of a
// first line that cites no footnote (the editor's own cut).
//
// Hunt 2026-10-08, cycle 6. Cluster Z19 (the cut side; the paste side is
// bug-paste-before-first-item-refused).
//
// Origin: regression from 24ef25f (the result gate decides for the cut).
// The probe passed at 10d599d, under the old checks.
//
// Source of truth: the README ("Cut takes the definitions that nothing
// else in the note uses along with the text, in the same undo step");
// ADR 0003 (when the plugin cannot tell what the user meant, it does what
// the editor would do without it); the result gate design's check 5 (the
// lines outside the edit keep their block shape: paragraph, heading, list
// item, quote, table). "- b", "> b", and "b" keep theirs. That the line
// under the cut now starts the list, quote, or paragraph is what taking
// out the line above it means.
//
// The "result gate" is the one check every edit passes before it is
// written: the note after must read as the note before, except for what
// the action meant to change.
//
// Cause: check 5's sameKind in src/editor/result-gate.ts compares each
// line's blocks, with a "^" mark on each block that starts on that line.
// Before the cut, "- b" carried on a list that started on the line above;
// after it, "- b" starts the list, so its marks differ. sameKind forgives
// only the other direction, and only for a paragraph: a line that started
// a paragraph may come to carry on the one above it. Lists, quotes, and a
// paragraph's carried-on line that comes to start it get no leeway, so the
// gate reads "- b" as a line read differently and refuses the cut.

/** A stand-in for the browser's clipboard event: it records what the plugin writes to the clipboard. */
function clipboardEvent() {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: () => "",
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
/** A fake plugin whose active note is `doc`. */
function pluginIn(doc: FakeEditor): FootnotePlugin {
    const plugin = fakePlugin({ carryFootnotesOnCopy: true, lintOnFootnoteCreation: false }, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path: "note.md" } }), getLeavesOfType: () => [] };
    return plugin;
}
/** Cuts `from` to `to`; returns the note, the clipboard text, and whether the plugin took the cut over. */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: to, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(pluginIn(doc), event as never);
    return { lines: doc.lines.slice(), clip: event.written["text/plain"], taken: event.defaultPrevented };
}
const line0 = { line: 0, ch: 0 };
const line1 = { line: 1, ch: 0 };
/** The cut's refusal notices shown so far. */
const refused = () => messages().filter((m) => m.startsWith("Nothing was cut"));

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a whole-line cut of a block's first line that cites a footnote", () => {
    it("control: the same cut of a line with no footnote is the editor's own (the plugin leaves it)", () => {
        const c = cut(["- a", "- b", "", "x"], line0, line1);
        expect(c.taken).toBe(false);
        expect(refused()).toEqual([]);
    });

    it("control: cutting the second item, with its footnote, goes through", () => {
        const c = cut(["- a", "- b[^1]", "- c", "", "[^1]: one"], line1, { line: 2, ch: 0 });
        expect(refused()).toEqual([]);
        expect(c.lines.slice(0, 2)).toEqual(["- a", "- c"]);
    });

    // Each case below is refused now, with the note left as it was.
    it.fails("the first item of a list: '- a[^1]' over '- b'", () => {
        const c = cut(["- a[^1]", "- b", "", "[^1]: one"], line0, line1);
        expect(refused()).toEqual([]);
        expect(c.clip).toContain("[^1]: one");
        expect(c.lines[0]).toBe("- b");
    });

    it.fails("the first item of an ordered list", () => {
        const c = cut(["1. a[^1]", "2. b", "", "[^1]: one"], line0, line1);
        expect(refused()).toEqual([]);
        expect(c.lines[0]).toBe("2. b");
    });

    it.fails("the first item of a list under a heading, its footnote cited again elsewhere (the definition stays)", () => {
        const c = cut(["# H", "", "- a[^1]", "- b", "", "Text[^1].", "", "[^1]: one"], { line: 2, ch: 0 }, { line: 3, ch: 0 });
        expect(refused()).toEqual([]);
        expect(c.lines).toEqual(["# H", "", "- b", "", "Text[^1].", "", "[^1]: one"]);
    });

    it.fails("the first line of a quote: '> a[^1]' over '> b'", () => {
        const c = cut(["> a[^1]", "> b", "", "[^1]: one"], line0, line1);
        expect(refused()).toEqual([]);
        expect(c.lines[0]).toBe("> b");
    });

    it.fails("the first line of a two-line paragraph: 'a[^1]' over 'b'", () => {
        const c = cut(["a[^1]", "b", "", "[^1]: one"], line0, line1);
        expect(refused()).toEqual([]);
        expect(c.lines[0]).toBe("b");
    });

    it.fails("the first item's text alone (no line break), leaving an empty line above '- b'", () => {
        const c = cut(["- a[^1]", "- b", "", "[^1]: one"], line0, { line: 0, ch: 7 });
        expect(refused()).toEqual([]);
        expect(c.lines.slice(0, 2)).toEqual(["", "- b"]);
    });

    it.fails("the first task of a task list: '- [ ] a[^1]' over '- [ ] b'", () => {
        const c = cut(["- [ ] a[^1]", "- [ ] b", "", "[^1]: one"], line0, line1);
        expect(refused()).toEqual([]);
        expect(c.lines[0]).toBe("- [ ] b");
    });

    it.fails("the first body line of a callout: '> a[^1]' under '> [!note] Title'", () => {
        const c = cut(["> [!note] Title", "> a[^1]", "> b", "", "[^1]: one"], line1, { line: 2, ch: 0 });
        expect(refused()).toEqual([]);
        expect(c.lines.slice(0, 2)).toEqual(["> [!note] Title", "> b"]);
    });
});
