import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeEditor as sharedFakeEditor, FakeEditor } from "./helpers/fake-editor";
import { fakePlugin as sharedFakePlugin } from "./helpers/fake-plugin";
import { messages, resetNotices } from "./helpers/notices";

import FootnotePlugin from "../src/main";
import { pasteInlineFootnote } from "../src/commands/insert-or-navigate-footnotes";

// Jason's report (2026-10-03, 0.3.0-beta.2): with a web address on the
// clipboard, "Paste as inline footnote" refused with the toast "footnotes
// can't go inside code, math, or other protected text" and wrote nothing.
//
// What Obsidian does: its own parser reads
// "Some text^[https://curriculum.buildingasecondbrain.com/] after." as one
// live inline footnote whose closing bracket is the one after the address
// (probed through app.metadataCache.computeMetadataAsync on 2026-10-03:
// an inline footnote from column 11 to 55). The inline footnote's brackets
// are matched before the address inside it is read.
//
// Why the plugin refused: before checking that the new "^[...]" survives,
// it blots out every bare web address as text no footnote can live in, and
// its address reader runs until a space or "<", so it swallowed the
// closing "]" too and the footnote looked broken. A reference glued to the
// end of an address ("https://example.com/[^1]") really is swallowed by the
// address in Obsidian, so the fix belongs in the order brackets and
// addresses are read, not in what an address may hold (the 2026-10-03
// probe confirmed that case too).
//
// Expected to fail until the fix lands.

function fakeEditor(line: string, ch: number): FakeEditor {
    return sharedFakeEditor([line], { cursor: { line: 0, ch }, edits: true });
}

function fakePlugin(doc: FakeEditor): FootnotePlugin {
    return sharedFakePlugin(
        {
            insertAtEndOfWord: false,
            enablePopupEditor: false,
            enableFootnotePrefix: false,
        },
        doc,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
    resetNotices();
});

describe("Paste as inline footnote with a web address on the clipboard", () => {
    it.fails("wraps the address in an inline footnote", async () => {
        vi.stubGlobal("navigator", {
            clipboard: { readText: () => Promise.resolve("https://curriculum.buildingasecondbrain.com/") },
        });
        const doc = fakeEditor("Some text after.", 9);
        await pasteInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["Some text^[https://curriculum.buildingasecondbrain.com/] after."]);
        expect(messages()).toEqual([]);
    });

    it.fails("wraps words followed by an address", async () => {
        vi.stubGlobal("navigator", {
            clipboard: { readText: () => Promise.resolve("see https://example.com/page") },
        });
        const doc = fakeEditor("Some text after.", 9);
        await pasteInlineFootnote(fakePlugin(doc));
        expect(doc.lines).toEqual(["Some text^[see https://example.com/page] after."]);
        expect(messages()).toEqual([]);
    });
});
