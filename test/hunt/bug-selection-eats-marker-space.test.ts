import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (wrong output): turning a selected callout title or custom task
// text into a footnote eats the space after the marker.
//
// What the user would see: they select "Title" in "> [!note]- Title" and
// press the footnote key. The line becomes "> [!note]-[^1]", which is no
// callout to Obsidian: the box turns into a plain quote. On
// "> [!note] Title" and "- [/] task", the glued result would read as a
// link, so the press is refused with the link notice instead, and the
// selection cannot be converted at all.
//
// Hunt 2026-10-05, round 1, lens refusals. Cluster RF8.
//
// Source of truth: absorbLeadingSpace's own docstring (the space is left
// alone after a list, task, heading, or quote marker, since stripping it
// would break the structure); Obsidian's callout regex
// /^\[!([^\]]+)\]([+\-]?)(?:\s|$)/ and task regex /^\[(.)][ \t]/ (its
// app.js), which both need the space; the stock task box "- [ ] task",
// which keeps it today.
//
// Cause: absorbLeadingSpace (selection-footnote.ts) swallows the spaces
// in front of the selection unless the text before them matches its
// marker pattern, and that pattern knows only the "[ ]", "[x]", and
// "[X]" task boxes. It knows no callout marker "[!note]" (with or
// without its fold sign) and no custom task box such as "[/]".

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

/** Selects `from`-`to` on the first line of `lines`, presses the footnote key `fn`, and returns the editor. */
async function convert(lines: string[], from: number, to: number, fn = insertAutonumFootnote) {
    const doc = fakeEditor([...lines], {
        cursor: { line: 0, ch: to },
        selection: { anchor: { line: 0, ch: from }, head: { line: 0, ch: to } },
        edits: true,
        wholeDoc: true,
    });
    await fn(fakePlugin(Settings, doc));
    return doc;
}

describe("converting the text after a callout marker or a custom task box keeps the space", () => {
    for (const [line, expected] of [
        ["> [!note] Title", "> [!note] [^1]"],
        ["> [!note]- Title", "> [!note]- [^1]"],
        ["- [/] task", "- [/] [^1]"],
    ] as [string, string][]) {
        it(`numbered key on the last word of ${JSON.stringify(line)}`, async () => {
            const from = line.lastIndexOf(" ") + 1;
            const doc = await convert(line.startsWith(">") ? [line, "> body"] : [line], from, line.length);
            // Before the fix: the link notice, or "> [!note]-[^1]".
            expect(messages()).toEqual([]);
            expect(doc.lines[0]).toBe(expected);
        });
    }

    it("inline key on a callout title keeps the space", async () => {
        const doc = await convert(["> [!note]- Title", "> body"], 11, 16, insertInlineFootnote);
        // Before the fix: "> [!note]-^[Title]".
        expect(doc.lines[0]).toBe("> [!note]- ^[Title]");
    });
});
