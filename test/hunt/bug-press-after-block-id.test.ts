import { beforeEach, describe, expect, it } from "vitest";

import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import type FootnotePlugin from "../../src/main";
import type { FootnotePlacement } from "../../src/parsing/landing";
import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote } from "../../src/commands/insert-or-navigate-footnotes";

// BUG (wrong output): a press with the caret at the end of a line that
// ends in a block id writes the reference after the id, and the paragraph
// loses its id.
//
// What the user would see: "Oysters filter water. ^water1", the caret at
// the end of the line (after typing, or after clicking the line's end),
// and any footnote key. The line becomes "Oysters filter water.
// ^water1[^1]". Footnote 1 shows, but Obsidian no longer finds the block
// "water1", so every "[[Note#^water1]]" link to that paragraph, from this
// note or any other, stops resolving.
//
// A "block id" is the "^water1" at the end of a paragraph that lets other
// notes link to that one paragraph.
//
// Hunt 2026-10-08, cycle 6. Cluster Z12.
//
// Origin: pre-existing.
//
// Source of truth: live answers c6:z12-after-id ("Oysters filter water.
// ^water1[^1]": the metadata cache registers no block, so
// "[[#^water1]]" finds nothing) and c6:z12-before-id ("Oysters filter
// water.[^1] ^water1": the block water1 is registered, and footnote 1
// shows), both Obsidian 1.14.4 on sprout, 2026-10-08;
// docs/obsidian-reading-rules.md D4 (a block id counts only at the very
// end of its block; the app's block-id pattern ends in "$"). Either a
// landing in front of the id or a refusal that leaves the line as it was
// keeps the link working, so the tests accept both.
//
// Cause: the landing (src/parsing/landing.ts) treats "^water1" as one more
// word and writes after it. The result gate cannot catch it, because the
// plugin's note reading does not look at block ids at all: they change
// nothing about footnotes (rule D4), only about block links.

const Settings = {
    insertAtEndOfWord: true,
    footnotePlacement: "after" as const,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
};

const line = "Oysters filter water. ^water1";

type Press = (plugin: FootnotePlugin) => Promise<void>;

/** Each key with the reference it writes: numbered "[^1]", named the empty "[^]" that waits for a name, inline the empty "^[]". */
const Keys: [string, Press, string][] = [
    ["numbered", insertAutonumFootnote, "[^1]"],
    ["named", insertNamedFootnote, "[^]"],
    ["inline", insertInlineFootnote, "^[]"],
];

/** Presses `key` with the caret at `ch` of the line under the given placement, and returns the editor. */
async function press(key: Press, ch: number, footnotePlacement: FootnotePlacement = "after") {
    const doc = fakeEditor([line, "", "See [[#^water1]]."], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await key(fakePlugin({ ...Settings, footnotePlacement }, doc));
    return doc;
}

/** The line still ends in its block id: either unchanged (refused), or with the reference right after "water." and the id after it. */
function expectIdKept(written: string, reference: string) {
    expect(written).toMatch(/ \^water1$/);
    expect([line, `Oysters filter water.${reference} ^water1`]).toContain(written);
}

beforeEach(resetNotices);

describe("a press at the end of a line ending in a block id", () => {
    // Now: the numbered key writes "Oysters filter water. ^water1[^1]", the
    // named key "... ^water1[^]", the inline key "... ^water1^[]".
    it.fails.each(Keys)("the %s key keeps the block id at the end of the line", async (_name, key, reference) => {
        const doc = await press(key, line.length);
        expectIdKept(doc.lines[0], reference);
    });

    // "none" is the setting shown as "Don't move". Now: "Oysters filter
    // water. ^water1[^1]" under both placements.
    it.fails.each(["before", "none"] as const)("the numbered key keeps the block id at the end of the line under the %s placement", async (placement) => {
        const doc = await press(insertAutonumFootnote, line.length, placement);
        expectIdKept(doc.lines[0], "[^1]");
    });

    it.each(Keys)("control: the %s key with the caret on 'water' lands in front of the id", async (_name, key, reference) => {
        const doc = await press(key, "Oysters filter water".length);
        expect(doc.lines[0]).toBe(`Oysters filter water.${reference} ^water1`);
    });
});
