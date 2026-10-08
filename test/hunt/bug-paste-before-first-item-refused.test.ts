import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a carried paste of a list item in front of a list's
// first item pastes nothing.
//
// What the user would see: the note is "- a", "- b[^1]", "- c", "",
// "[^1]: one". To move "- b[^1]" to the top, they select its line with
// Shift+Down and press Ctrl+X: the item goes, and "[^1]: one" with it.
// They put the caret at the start of "- a" and press Ctrl+V. Nothing is
// pasted, and the notice says "Nothing was pasted: it would change how
// Obsidian reads the text around it." The item and its definition are now
// only on the clipboard. The same happens to "2. b[^1]" pasted in front of
// "1. a", and to an item moved to the top of a loose list (one with blank
// lines between its items). The same paste with no footnote is the
// editor's own and lands, and so does a footnoted item pasted between two
// items.
//
// A "carried" paste is one whose clipboard holds definitions under the
// text, which the plugin takes over to add them to the note.
//
// Hunt 2026-10-08, cycle 6. Cluster Z19 (the paste side; the cut side is
// bug-cut-first-line-of-block-refused).
//
// Origin: regression from 24ef25f (the result gate decides for the
// carried paste). The probe passed at 10d599d, under the old checks.
//
// Source of truth: the README ("Paste inside Obsidian strips those lines
// back off and lands the text and the definitions"); ADR 0003 (when the
// plugin cannot tell what the user meant, it does what the editor would
// do without it); the result gate design's check 5 (the lines outside the
// edit keep their block shape: paragraph, heading, list item, quote,
// table). "- a" is still a list item.
//
// Left out on purpose. An ordered list's "Text[^1] here." pasted in front
// of "2. second" is refused rightly: "2." cannot interrupt a paragraph
// (docs/obsidian-reading-rules.md B5), so "2. second" would become part of
// that paragraph. A footnoted paragraph pasted in front of "- second item"
// of a loose list splits one list in two; whether that is what the user
// meant is a sub-case left for Jason.
//
// The "result gate" is the one check every edit passes before it is
// written: the note after must read as the note before, except for what
// the action meant to change.
//
// Cause: check 5's sameKind in src/editor/result-gate.ts compares each
// line's blocks, with a "^" mark on each block that starts on that line.
// Before the paste, "- a" starts the list; after it, "- a" carries on the
// list the pasted item starts, so its marks differ. sameKind forgives this
// only for a paragraph (a line that started one may come to carry on the
// one above it), never for a list, so the gate refuses the paste.

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
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
const settings = { carryFootnotesOnCopy: true, lintOnFootnoteCreation: false };
/** A fake plugin whose active note is `doc`. */
function pluginIn(doc: FakeEditor): FootnotePlugin {
    const plugin = fakePlugin(settings, doc);
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
/** Pastes `clip` at `at`; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], at: Pos, clip: string) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    const event = clipboardEvent(clip);
    handlePaste(pluginIn(doc), event as never, doc);
    return { lines: doc.lines, taken: event.defaultPrevented };
}
/** The paste's refusal notices shown so far. */
const refused = () => messages().filter((m) => m.startsWith("Nothing was pasted"));

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a whole-line paste of a footnoted item in front of a list's first item", () => {
    it("control: the same line with no footnote is the editor's own paste (the plugin leaves it)", () => {
        const result = paste(["- a", "- c"], { line: 0, ch: 0 }, "- b\n");
        expect(result.taken).toBe(false);
    });

    it("control: a list item with its footnote pasted between two items of a tight list lands", () => {
        const result = paste(["- a", "- c", "- d"], { line: 1, ch: 0 }, "- b[^1]\n\n[^1]: one\n");
        expect(refused()).toEqual([]);
        expect(result.lines.slice(0, 4)).toEqual(["- a", "- b[^1]", "- c", "- d"]);
    });

    // Each case below pastes nothing now, with the refusal notice.
    it.fails("moving a list item to the top: '- b[^1]' cut from a tight list, pasted at the start of '- a'", () => {
        const c = cut(["- a", "- b[^1]", "- c", "", "[^1]: one"], { line: 1, ch: 0 }, { line: 2, ch: 0 });
        expect(c.taken).toBe(true);
        const result = paste(c.lines, { line: 0, ch: 0 }, c.clip);
        expect(refused()).toEqual([]);
        expect(result.lines.slice(0, 3)).toEqual(["- b[^1]", "- a", "- c"]);
        expect(result.lines).toContain("[^1]: one");
    });

    it.fails("moving an ordered item to the top: '2. b[^1]' pasted at the start of '1. a'", () => {
        const result = paste(["1. a", "3. c", "", "[^9]: other"], { line: 0, ch: 0 }, "2. b[^1]\n\n[^1]: one\n");
        expect(refused()).toEqual([]);
        expect(result.lines.slice(0, 3)).toEqual(["2. b[^1]", "1. a", "3. c"]);
    });

    it.fails("moving an item to the top of a loose list: '- b[^1]' cut and pasted at the start of '- a'", () => {
        const list = ["- a", "", "- b[^1]", "", "- c", "", "[^1]: one"];
        const c = cut(list, { line: 2, ch: 0 }, { line: 3, ch: 0 });
        expect(c.taken).toBe(true);
        const result = paste(c.lines, { line: 0, ch: 0 }, c.clip);
        expect(refused()).toEqual([]);
        expect(result.lines.join("\n")).toContain("- b[^1]\n- a");
        expect(result.lines.join("\n")).toContain("[^1]: one");
    });
});
