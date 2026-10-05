import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { BlockSyntaxNotice } from "../../src/editor/notice";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): the plugin knows only the stock task boxes "[ ]",
// "[x]", and "[X]", so a custom task status such as "- [/] task" is
// written into, and a definition behind one is read as a reference.
//
// What the user would see: themes and task plugins use custom statuses
// ("- [/]" in progress, "- [-]" cancelled, "- [>]" deferred). Obsidian
// treats every one of them as a task box. With the caret inside "[/]",
// a press writes into the box, "- [[^1]/] task", and the task is a task
// no more. With the caret just after "]", the refusal names a link
// instead of block syntax. And "- [/] [^a]: text", a footnote definition
// inside a task item to Obsidian, reads to the plugin as a reference: a
// press on its label appends a second "[^a]:" definition.
//
// Hunt 2026-10-05, round 1, lens refusals. Clusters RF1 and RF2.
//
// Source of truth: Obsidian's own list tokenizer reads ANY single
// character in the box as a task. Its checkbox regex is /^\[(.)][ \t]/
// in its app.js and worker.js, and the box is sliced off before the
// item's content is tokenized. The block-syntax ruling of 2026-10-03 (a
// press never writes into block syntax); Obsidian's answer
// broad:20261004-4658 ("- [ ] [^Note]: ..." is a definition in a task
// item).
//
// Cause: src/parsing/remark-parse-list.js keeps stock remark's checkbox
// regex /^\[([ X\tx])][ \t]/, so the reader sees "[/]" as text (a
// shortcut reference link) and blockSyntaxEnd (the column where a line's
// block syntax ends and its text begins) stops at the list marker.

const Settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

type Press = typeof insertAutonumFootnote;

/** Presses the footnote key `fn` with the caret at `line`, `ch` of a note holding `lines`, and returns the editor. */
async function press(fn: Press, lines: string[], line: number, ch: number) {
    const doc = fakeEditor([...lines], { cursor: { line, ch }, edits: true, wholeDoc: true, words: true });
    await fn(fakePlugin(Settings, doc));
    return doc;
}

beforeEach(resetNotices);

describe("a caret inside a custom task box refuses like one inside [ ] or [x]", () => {
    for (const [line, ch] of [
        ["- [/] task", 3],
        ["- [/] task", 4],
        ["- [-] task", 3],
        ["- [>] task", 3],
        ["1. [/] task", 4],
    ] as [string, number][]) {
        for (const [name, fn] of [["numbered", insertAutonumFootnote], ["named", insertNamedFootnote], ["inline", insertInlineFootnote]] as [string, Press][]) {
            it(`${name} key at ch ${ch} of ${JSON.stringify(line)}`, async () => {
                const doc = await press(fn, [line], 0, ch);
                // Today, for example: "- [[^1]/] task".
                expect(doc.lines).toEqual([line]);
                expect(messages()).toEqual([BlockSyntaxNotice]);
            });
        }
    }

    it("the numbered key right after a custom box's ']' gets the block-syntax notice, not the link one", async () => {
        const doc = await press(insertAutonumFootnote, ["- [/] task"], 0, 5);
        expect(doc.lines).toEqual(["- [/] task"]);
        // Today: the link notice.
        expect(messages()).toEqual([BlockSyntaxNotice]);
    });
});

describe("a definition behind a custom task box", () => {
    it("reads as a definition, as it does behind '- [ ] '", () => {
        expect(readNote(["- [ ] [^a]: text"]).definitions.map((d) => d.name)).toEqual(["a"]);
        // Today: no definition, and "[^a]" reads as a reference.
        expect(readNote(["- [/] [^a]: text"]).definitions.map((d) => d.name)).toEqual(["a"]);
        expect(readNote(["- [/] [^a]: text"]).referencesOn(0)).toEqual([]);
    });

    it("a press with the caret on its label appends no second definition", async () => {
        const lines = ["- [/] [^a]: text"];
        const doc = await press(insertAutonumFootnote, lines, 0, 8);
        // Today: ["- [/] [^a]: text", "", "[^a]: "].
        expect(doc.lines).toEqual(lines);
    });
});
