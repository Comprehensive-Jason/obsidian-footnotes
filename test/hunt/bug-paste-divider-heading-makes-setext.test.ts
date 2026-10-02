import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (wrong output): in a note whose only line is the new text, the
// footnote section heading lands directly under that line. With a heading
// setting that starts with a "---" divider, the line becomes a heading.
//
// What the user would see: the section heading setting is "---" over
// "## Footnotes". They paste "a[^1] b" with its definition into a new,
// empty note. The note reads "a[^1] b", then "---" right under it. A "---"
// directly under a paragraph is a setext underline (a line of "-" or "="
// that makes the paragraph above it a heading), so "a[^1] b" shows as a
// large H2 heading and the divider is gone. Pressing the numbered-footnote
// key in an empty note does the same: the note reads "[^1]", "---",
// "## Notes", "", "[^1]: ", and the reference line becomes a heading.
//
// Hunt 2026-10-02, round 2, lens interactions. Cluster I2.
//
// Source of truth: the section heading setting adds a heading above the
// definitions; it should not change what the text above it is. Where a
// note already has text, the creation press gives the heading a blank
// line above it.

// A stand-in for the browser's clipboard event: it reads `text` and
// records what the plugin writes back.
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

// A fake editor holding `lines`, with the caret at the start of line 0.
function emptyNote(lines: string[]) {
    const at = { line: 0, ch: 0 };
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at }, words: true });
}

// The settings around the edit, with a divider section heading switched on.
function settings(footnoteSectionHeading: string) {
    return {
        carryFootnotesOnCopy: true,
        enablePopupEditor: false,
        insertAtEndOfWord: false,
        enableFootnotePrefix: false,
        enableFootnoteSectionHeading: true,
        footnoteSectionHeading,
        enableRemoveBlankLastLines: true,
        removeEmptySectionHeading: true,
        lintOnFootnoteCreation: false,
    };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a divider section heading in a note that holds only the new text", () => {
    it.fails("paste into an empty note with a divider heading: the pasted paragraph does not become a setext heading", () => {
        const doc = emptyNote([""]);
        handlePaste(fakePlugin(settings("---\n## Footnotes"), doc), clipboardEvent("a[^1] b\n\n[^1]: one") as never, doc);
        // "a[^1] b" directly above "---" would be an H2.
        const i = doc.lines.indexOf("---");
        expect(doc.lines[i - 1]).toBe("");
    });

    it.fails("press in an empty note with a divider heading: the reference line does not become a setext heading", async () => {
        const doc = emptyNote([""]);
        await insertAutonumFootnote(fakePlugin(settings("---\n## Notes"), doc));
        // Today: ["[^1]", "---", "## Notes", "", "[^1]: "].
        const i = doc.lines.indexOf("---");
        expect(doc.lines[i - 1]).toBe("");
    });
});
