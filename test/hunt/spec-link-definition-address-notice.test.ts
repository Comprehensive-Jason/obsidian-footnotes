import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { InsideLinkNotice } from "../../src/editor/notice";
import { messages, resetNotices } from "../helpers/notices";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";

// spec question: which notice should a press inside a link reference
// definition's address or title give?
//
// What it does now: a link reference definition is a line such as
// "[ref]: http://u" that gives "[x][ref]" links elsewhere in the note
// their address. A press there is refused either way, and the note is
// unchanged. With the caret in the label or at the end of the address,
// the refusal comes with the link notice. With the caret inside the
// address ("http" of "[ref]: http://u", or inside "<http://u>"), inside
// its title, or after the label of one whose address is on the next
// line, it comes with the protected-text notice ("code, math, or other
// protected text"), which names nothing on the line.
// What a user might expect: one notice for the whole line, the link
// notice, as the label and the end of the address give.
// Why it is a question and not a bug: nothing is written and nothing
// breaks; only the wording differs. Jason's ruling Q5 (2026-10-05) says a
// press on a link reference definition refuses with the link notice, but
// the faces it named were the label and the end of the address.
//
// Hunt 2026-10-05, round 2, lens press. Cluster P7.
//
// Source of truth: Jason's ruling Q5 of 2026-10-05 (pin
// spec-press-on-link-reference-definition, the "link" verdict in
// src/editor/insertion-liveness.ts). The protected-caret guard runs first
// and finds the masked address or title, so the "link" verdict is never
// asked.

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

describe("a press inside a link reference definition's address or title", () => {
    for (const [where, lines, ch, key] of [
        ["numbered key in the address", ["see [x][ref] now", "", "[ref]: http://u"], 9, insertAutonumFootnote],
        ["inline key in the address", ["see [x][ref] now", "", "[ref]: http://u"], 9, insertInlineFootnote],
        ["numbered key in an <...> address", ["see [x][ref] now", "", "[ref]: <http://u>"], 10, insertAutonumFootnote],
        ["numbered key in the title", ["see [x][ref] now", "", '[ref]: http://u "Title here"'], 18, insertAutonumFootnote],
        ["numbered key after the label of one whose address is on the next line", ["see [x][ref] now", "", "[ref]:", "http://u"], 6, insertAutonumFootnote],
    ] as [string, string[], number, typeof insertAutonumFootnote][]) {
        it.fails(`${where}: refuses with the link notice`, async () => {
            const doc = fakeEditor([...lines], { cursor: { line: 2, ch }, edits: true, wholeDoc: true, words: true });
            await key(fakePlugin(Settings, doc));
            expect(doc.lines).toEqual(lines);
            // Today: the protected-text notice.
            expect(messages()).toEqual([InsideLinkNotice]);
        });
    }
});
