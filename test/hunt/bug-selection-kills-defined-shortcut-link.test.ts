import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): turning a selected word inside a link the note
// defines into a footnote destroys the link without a word.
//
// What the user would see: the note says "I said [some text] here" and
// has a "[some text]: http://u" line, so "[some text]" is a link. The
// user selects "some" and presses the numbered key: the word moves into
// a new definition and the line becomes "I said [[^1] text] here". The
// link's label no longer matches its definition, so the link is gone,
// and no notice says so. Selecting "text" and pressing the inline key
// writes "I said [some^[text]] here", with the same result. A caret press
// inside the same link is refused with the link notice.
//
// Hunt 2026-10-05, round 2, lens press. Cluster P8.
//
// Source of truth: Obsidian draws a shortcut reference link only when a
// "[label]: url" line carries its label (CommonMark 0.31.2, section 6.3;
// 6d37374). Jason's landing rulings of 2026-09-15 (a reference never
// splits a link); the caret press's refusal with the link notice (pin
// bug-dont-move-bracketed-text). The tests accept either a refusal
// (note unchanged) or a write that keeps the link.
//
// Cause: the selection conversions (src/commands/selection-footnote.ts)
// check that the selection does not touch a footnote or protected text,
// and that the new reference is live, but not that the edit leaves the
// note's links whole. Their "link" verdict (pressLineVerdict in
// src/editor/insertion-liveness.ts) counts link reference definitions,
// which the edit does not change, not the links that use them.

const Settings = {
    insertAtEndOfWord: false,
    expandSelectionToWholeWords: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);

async function convert(lines: string[], line: number, from: number, to: number, fn = insertAutonumFootnote, toLine = line) {
    const doc = fakeEditor([...lines], {
        cursor: { line: toLine, ch: to },
        selection: { anchor: { line, ch: from }, head: { line: toLine, ch: to } },
        edits: true,
        wholeDoc: true,
    });
    await fn(fakePlugin(Settings, doc));
    return doc;
}

/** How many links the note draws: defined reference links and every other kind. */
function links(lines: string[]): number {
    const r = readNote(lines);
    return r.links.filter((l) => l.lookup === undefined || r.linkLabels.has(l.lookup)).length;
}

describe("selection inside a defined reference link", () => {
    it.fails("numbered: converting 'some' of a defined [some text] never kills the link silently", async () => {
        const lines = ["I said [some text] here", "", "[some text]: http://u"];
        const doc = await convert(lines, 0, 8, 12);
        // Either the note is unchanged, or the link survives the edit.
        if (doc.lines.join("\n") !== lines.join("\n")) {
            expect(links(doc.lines), JSON.stringify({ lines: doc.lines, messages: messages() })).toBe(1);
        }
    });

    it.fails("inline: wrapping 'text' of a defined [some text] never kills the link silently", async () => {
        const lines = ["I said [some text] here", "", "[some text]: http://u"];
        const doc = await convert(lines, 0, 13, 17, insertInlineFootnote);
        // Today: "I said [some^[text]] here".
        if (doc.lines.join("\n") !== lines.join("\n")) {
            expect(links(doc.lines), JSON.stringify({ lines: doc.lines, messages: messages() })).toBe(1);
        }
    });
});
