import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import type { FootnotePlacement } from "../../src/parsing/landing";
import { readNote } from "../../src/parsing/note-reading";
import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// BUG (annoyance): in "![alt text]" with no matching link definition, a
// press with the caret inside a word is refused, though a press at the
// start of the same word goes through.
//
// What the user would see: the note says "I said ![alt text] here" and
// has no "[alt text]: url" line, so Obsidian shows it as written, not as
// an image. With the caret at the start of "alt", the numbered key writes
// "I said ![alt[^1] text] here", a live footnote. With the caret two
// letters into "alt", the same key is refused with the protected-text
// notice. Same word, same landing spot, two outcomes. Placement After
// punctuation and Don't move both show it.
//
// Hunt 2026-10-05, round 2, lens press. Cluster P6.
//
// Source of truth: Obsidian 1.14.4, asked live on 2026-10-05: in "I said
// ![alt[^1] text] here" with no definition, [^1] is a live reference. In
// "I said ![alt[^1] text][img] here" with no "[img]:" line, [^1] is no
// reference, so a press inside that one rightly stays refused (the
// control). The plugin's reader agrees on the first (checked below).
//
// Cause: since 6d37374, linkLikeEndAt in src/parsing/landing.ts skips a
// reference link or image whose label is not defined, but the masked
// copy of the line that the protected-caret guard reads still blanks the
// alt text, so a caret inside a word of it counts as a caret in
// protected text. A caret at the word's start sits just outside the
// blanked span and passes.

const Settings = (footnotePlacement: FootnotePlacement) => ({
    insertAtEndOfWord: true,
    footnotePlacement,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
});

async function press(lines: string[], ch: number, placement: FootnotePlacement) {
    const doc = fakeEditor([...lines], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(Settings(placement), doc));
    return { lines: doc.lines, messages: messages() };
}

const Line = "I said ![alt text] here";

beforeEach(resetNotices);

describe.each(["after", "none"] as const)("undefined '![alt text]', placement %s", (placement) => {
    it.fails("a caret inside 'alt' gives the same result as a caret at its start", async () => {
        // The reader reads the landed reference as live, as Obsidian does.
        expect(readNote(["I said ![alt[^1] text] here"]).referencesOn(0).map((r) => r.name)).toEqual(["1"]);
        const atStart = await press([Line], Line.indexOf("alt"), placement);
        expect(atStart.lines[0]).toBe("I said ![alt[^1] text] here");
        resetNotices();
        const inside = await press([Line], Line.indexOf("alt") + 2, placement);
        // Today: inside is refused with the protected-text notice.
        expect(inside).toEqual(atStart);
    });

    it("control: in '![alt text][img]' with no '[img]:' line, a caret inside 'alt' stays refused", async () => {
        const line = "I said ![alt text][img] here";
        const inside = await press([line], line.indexOf("alt") + 2, placement);
        expect(inside.lines).toEqual([line]);
        expect(inside.messages.length).toBe(1);
    });
});
