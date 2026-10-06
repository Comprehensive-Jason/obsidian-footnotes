import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import type { FootnotePlacement } from "../../src/parsing/landing";
import { readNote } from "../../src/parsing/note-reading";
import { resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// BUG (wrong output): a press inside the text of a link that runs over a
// line break writes the footnote into the link text.
//
// What the user would see: a link's text runs on past a line break, as in
// "I said [some text" / "more](http://u) here". With the caret in "some"
// and placement set to After punctuation or Don't move, the numbered key
// writes "I said [some[^1] text": the reference sits inside the link's
// text. On one line the same press steps over the whole link and lands
// after its ")". Worse, with a shortcut link the note defines ("I said
// [some" / "text] here" and a "[some text]: http://u" line), the press
// writes "[some[^1]" / "text]": the link's label no longer matches its
// definition, so the link is gone. On one line that press is refused
// with the link notice.
//
// Hunt 2026-10-05, round 2, lens press. Cluster P4.
//
// Source of truth: Obsidian 1.14.4, asked live on 2026-10-05: "I said
// [some" / "text] here" with "[some text]: http://u" is drawn as ONE link
// "some text" to http://u. Jason's landing rulings of 2026-09-15 (a
// reference never splits a link); the round-2 hunt brief (real links are
// stepped over whole); the one-line behaviour (pin
// bug-dont-move-bracketed-text). The remedy is Jason's pick: refuse with
// the link notice, or land after the link's end on the next line. These
// tests ask only that the new reference sit outside every link and that
// the defined link survive, so either remedy turns them green.
//
// Cause: linkLikeEndAt in src/parsing/landing.ts returns -1 for a link
// that does not end on the caret's line, so the press lands at the end of
// the word inside the link text. The born-dead check passes it: a "[^1]"
// in link text reads live, and the "link" verdict counts link reference
// definitions, which did not change.

const Settings = (footnotePlacement: FootnotePlacement) => ({
    insertAtEndOfWord: true,
    footnotePlacement,
    enablePopupEditor: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableFootnotePrefix: false,
    enableRemoveBlankLastLines: true,
    lintOnFootnoteCreation: false,
});

async function press(lines: string[], ch: number, placement: FootnotePlacement) {
    const doc = fakeEditor([...lines], { cursor: { line: 0, ch }, edits: true, wholeDoc: true, words: true });
    await insertAutonumFootnote(fakePlugin(Settings(placement), doc));
    return doc;
}

/** Whether every "[^1]" the press wrote sits outside every link the reading finds. */
function referenceOutsideLinks(lines: string[]): boolean {
    const reading = readNote(lines);
    return reading.references
        .filter((r) => r.name === "1")
        .every((r) => !reading.insideLink(r.line, r.start));
}

/** How many links the note still draws: defined reference links and every other kind. */
function drawnLinks(lines: string[]): number {
    const reading = readNote(lines);
    return reading.links.filter((l) => l.lookup === undefined || reading.linkLabels.has(l.lookup)).length;
}

beforeEach(resetNotices);

describe.each(["after", "none"] as const)("a link whose text runs over a line break, placement %s", (placement) => {
    it.fails("inline link: the reference is not written into the link text", async () => {
        const lines = ["I said [some text", "more](http://u) here"];
        const doc = await press(lines, 10, placement);
        // Today: ["I said [some[^1] text", "more](http://u) here", "", "[^1]: "]
        expect(referenceOutsideLinks(doc.lines)).toBe(true);
    });

    it.fails("defined shortcut link over two lines: the link survives the press", async () => {
        const lines = ["I said [some", "text] here", "", "[some text]: http://u"];
        // The reader draws it as one link, as Obsidian does.
        expect(drawnLinks(lines)).toBe(1);
        const doc = await press(lines, 10, placement);
        // Today: ["I said [some[^1]", "text] here", ...]: no link drawn.
        expect(drawnLinks(doc.lines)).toBe(1);
    });
});
