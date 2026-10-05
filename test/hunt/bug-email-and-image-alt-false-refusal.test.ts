import { beforeEach, describe, expect, it } from "vitest";

import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { readNote } from "../../src/parsing/note-reading";

// BUG (annoyance): a press with the caret inside an email address or a
// reference-style image's alt text is refused, though the spot right
// after it would make a live footnote.
//
// What the user would see: the caret sits inside "<me@x.org>", inside a
// bare "me@x.org", or inside the alt text of "![alt][img]". The press is
// refused with the protected-text toast. The same press inside
// "<http://x.y>", "![alt](u)", or "[text][ref]" lands the footnote right
// after the whole construct.
//
// Hunt 2026-10-05, round 1, lens refusals. Cluster RF7.
//
// Source of truth: Jason's landing rulings of 2026-09-15 (a reference
// belongs after the whole link-like construct, never inside it); the
// plugin's own reader, which reads "see <me@x.org>[^1] now",
// "see me@x.org[^1] now", and "see ![alt][img][^1] now" as live
// footnotes. Whether Obsidian links a bare email address is not yet
// checked live; the press is refused either way.
//
// Cause: linkLikeEndAt (landing.ts), which finds the end of the
// link-like construct around the caret, knows markdown links,
// wikilinks, bare URLs, and "<scheme://...>" autolinks, but not email
// addresses or reference-style images, so the press writes inside them,
// the write reads dead, and it is refused.

const Settings = {
    insertAtEndOfWord: true,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

beforeEach(resetNotices);

/** Presses the numbered key with the caret at `ch` of the first line of `lines`, and returns the editor. */
async function press(lines: string[], ch: number) {
    const doc = fakeEditor([...lines], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(Settings, doc));
    return doc;
}

describe("a press inside a link-like construct lands after it", () => {
    for (const [lines, ch, expected] of [
        [["see <me@x.org> now"], 6, "see <me@x.org>[^1] now"],
        [["see me@x.org now"], 5, "see me@x.org[^1] now"],
        [["see ![alt][img] now", "", "[img]: http://u"], 7, "see ![alt][img][^1] now"],
    ] as [string[], number, string][]) {
        it(`at ch ${ch} of ${JSON.stringify(lines[0])}`, async () => {
            // The landing spot reads as a live footnote.
            expect(readNote([expected]).referencesOn(0).map((r) => r.name)).toEqual(["1"]);
            const doc = await press(lines, ch);
            // Before the fix: the protected-text toast.
            expect(messages()).toEqual([]);
            expect(doc.lines[0]).toBe(expected);
        });
    }
});
