// BUG (wrong output): a carried paste is refused when the note's footnotes
// sit above the paste and anything below the paste holds a link, a code
// span, a wikilink, or a reference.
//
// What the user would see: "Oysters filter water[^1]." / "" / "[^1]: Jones
// 2019." / "" / "The tide rose more slowly, see [the survey](https://
// example.org).", definitions under the paragraph that cites them, as a
// note looks before its first lint. They paste a sentence carrying its own
// footnote after "rose" in the last line. Nothing is pasted: "Nothing was
// pasted: it would change how Obsidian reads the text around it." (or the
// protected-text notice when a code span is below). Moving a cited sentence
// down the note the same way (Shift+Down, Ctrl+X, Ctrl+V) leaves it only on
// the clipboard. With the footnotes at the bottom of the note, or plain
// prose below, the same paste goes through.
//
// Hunt 2026-10-09, cycle 8. Cluster V10, lens the gate.
// Source of truth: ADR 0003; the README's carry promise (the text and its
// definitions land where a new footnote would go).
// Origin: a regression from 24ef25f (2026-10-08, the result gate deciding
// the carried paste), missed by cycles 6 and 7: green at 24ef25f's parent,
// red at 24ef25f, 34d5377, and 3a47f7a. The paste tells the gate the wrong
// lines are its own (pasteIntent in carry-footnotes-hooks.ts, from 89815e1).
// The "result gate" is the one check every edit passes before it is
// written: the note after must read the same as the note before, except
// for what the edit meant to change (ADR 0003).

import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import type FootnotePlugin from "../../src/main";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { DEFAULT_SETTINGS } from "../../src/settings";

// probe: a carried paste below the note's last definition block.
// The definitions the paste carries are appended after that block, ABOVE
// the place the text is pasted. pasteIntent (carry-footnotes-hooks.ts)
// tells the result gate that the paste wrote everything from the appended
// definitions to the end of the note (`to: { line: after.length }`), and
// gives the pasted text's place as it stood before the definitions pushed
// it down. So on the note after the paste the gate leaves out every line
// below the appended definitions as the user's own text, while on the note
// before it still counts them: any link, wikilink, code span, or footnote
// reference down there reads as gone, and the paste is refused ("Nothing
// was pasted: ..."). The same paste with the definitions at the bottom of
// the note goes through. Definitions under the paragraph that cites them
// are what a note has before its first lint (the lint runs on the command,
// or on save when that setting is on; both off by default).

type Pos = { line: number; ch: number };
function clipboardEvent(text = "") {
    const event = {
        defaultPrevented: false,
        clipboardData: { types: ["text/plain"], getData: (type: string) => (type === "text/plain" ? text : ""), setData() {} },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}
function pluginIn(doc: FakeEditor): FootnotePlugin {
    const plugin = fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false, lintOnFootnoteCreation: false }, doc);
    (plugin.app as unknown as { workspace: unknown }).workspace = { getActiveViewOfType: () => ({ editor: doc, file: { path: "note.md" } }), getLeavesOfType: () => [] };
    return plugin;
}
function paste(lines: string[], at: Pos, text: string) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    const taken = handlePaste(pluginIn(doc), clipboardEvent(text) as never, doc);
    if (!taken) doc.transaction({ changes: [{ from: at, to: at, text }] });
    return doc.lines.slice();
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

// a copy of one sentence citing a footnote, as the plugin's copy writes it to the clipboard
const SENTENCE = "Smith found the same[^2].\n\n[^2]: Smith 2020, p. 4.";

describe("a carried paste into a paragraph below a definition in the middle of the note", () => {
    // Notes whose definitions sit right under the paragraph that cites them
    // (the lint's move to the bottom has not run: it runs on the command,
    // or on save when that is turned on), and a later paragraph.
    const mid = (later: string) => ["Oysters filter water[^1].", "", "[^1]: Jones 2019.", "", later];
    const at = (later: string) => ({ line: 4, ch: later.indexOf(" more") });
    const laters: [string, string][] = [
        ["a link", "The tide rose more slowly, see [the survey](https://example.org)."],
        ["a footnote reference", "The tide rose more slowly[^1]."],
        ["inline code", "The tide rose more slowly in `run-3`."],
        ["a wikilink", "The tide rose more slowly, see [[Tides]]."],
    ];
    for (const [what, later] of laters) {
        it(`pastes a sentence citing a footnote into a later paragraph holding ${what}`, () => {
            const after = paste(mid(later), at(later), " " + SENTENCE.split("\n")[0].replace(/\.$/, "") + "\n\n" + SENTENCE.split("\n\n")[1]);
            expect(messages().filter((m) => m.startsWith("Nothing was pasted"))).toEqual([]);
            expect(after.join("\n")).toContain("Smith found the same[^2]");
            expect(after.join("\n")).toContain("[^2]: Smith 2020, p. 4.");
        });
    }
    it("control: into a later paragraph of plain prose, with nothing below for the gate to count, the paste goes through", () => {
        const later = "The tide rose more slowly.";
        const after = paste(mid(later), at(later), " Smith found the same[^2]\n\n[^2]: Smith 2020, p. 4.");
        expect(messages().filter((m) => m.startsWith("Nothing was pasted"))).toEqual([]);
        expect(after.join("\n")).toContain("Smith found the same[^2]");
    });

    it("moves a sentence with its footnote down the note: cut, then paste into a later paragraph holding a link", () => {
        const before = ["Intro[^1] text.", "", "[^1]: One.", "", "Oysters filter water[^2].", "", "[^2]: Jones 2019.", "", "The tide rose, see [the survey](https://example.org)."];
        // Shift+Down on "Oysters filter water[^2]." and Ctrl+X: the line and its definition, which nothing else cites, go to the clipboard
        const doc = fakeEditor(before, { wholeDoc: true, edits: true, cursor: { line: 5, ch: 0 }, selection: { anchor: { line: 4, ch: 0 }, head: { line: 5, ch: 0 } } });
        const event = { written: {} as Record<string, string>, defaultPrevented: false, clipboardData: { types: ["text/plain"], getData: () => "", setData: (t: string, v: string) => { event.written[t] = v; } }, preventDefault() { event.defaultPrevented = true; }, stopPropagation() {} };
        handleCut(pluginIn(doc), event as never);
        expect(doc.lines.join("\n")).not.toContain("[^2]");
        const clip = event.written["text/plain"];
        expect(clip).toContain("[^2]: Jones 2019.");
        // then the caret after "rose" in the last paragraph, and Ctrl+V
        const last = doc.lines.length - 1;
        resetNotices();
        const after = paste(doc.lines, { line: last, ch: doc.lines[last].indexOf(",") }, clip.replace(/\n$/, ""));
        expect(messages().filter((m) => m.startsWith("Nothing was pasted"))).toEqual([]);
        expect(after.join("\n")).toContain("[^2]: Jones 2019.");
    });

    it("control: the same paste with the definition at the bottom of the note passes", () => {
        const later = "The tide rose more slowly, see [the survey](https://example.org).";
        const before = ["Oysters filter water[^1].", "", later, "", "[^1]: Jones 2019."];
        const after = paste(before, { line: 2, ch: later.indexOf(" more") }, " Smith found the same[^2]\n\n[^2]: Smith 2020, p. 4.");
        expect(messages().filter((m) => m.startsWith("Nothing was pasted"))).toEqual([]);
        expect(after.join("\n")).toContain("Smith found the same[^2]");
    });
});
