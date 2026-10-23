import { beforeEach, describe, expect, it } from "vitest";

import FootnotePlugin from "../../src/main";
import { insertAutonumFootnote, insertInlineFootnote, insertNamedFootnote, pasteInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { MultiCaretInFootnotesNotice, MultiCaretNestedNotice } from "../../src/editor/notice";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// A press with several carets, every one of them inside a footnote, that
// the plugin refuses. It refused with "No footnotes were created: footnotes
// can't be nested inside other footnotes.", but nothing would be nested in
// any of these: the carets sit in footnotes of different kinds (a reference
// and an inline footnote), in references of different names, in inline
// footnotes some empty and some filled, all in a reference whose footnote
// already has a definition, or (the paste key) all in references of one
// name. The press there would mean different things at different carets,
// or there is nothing to carry on from, so it is refused whole. Seen live
// on sprout's Obsidian 1.14.4 on 2026-10-22 (run toast-bugs): each case
// left the note and the carets as they were under the nesting toast.
//
// Expected (Jason asked for a true notice, 2026-10-22; the wording is the
// plainer of the run's two drafts, for his review): "No footnotes were
// created: the carets are inside existing footnotes. Move them into the
// text." The refusal itself stays. A caret inside a footnote beside carets
// on plain text keeps the nesting notice: there the press would put the
// new footnote inside that one.
//
// Origin: pre-existing, red at a9acb87. Found by reading the code for the
// toast inventory of 2026-10-22 (its "odd things" item 2).

const settings = {
    insertAtEndOfWord: false,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

const NOTE = ["Alpha[^a] beta[^b] gamma[^c] delta[^c] eps[^a] ^[x] and ^[] here plain words.", "", "[^a]: A.", "[^b]: B."];
const line = NOTE[0];
/** A caret two characters into the n-th (from 0) occurrence of `needle` on the note's first line. */
function inside(needle: string, n = 0) {
    let at = -1;
    for (let i = 0; i <= n; i++) at = line.indexOf(needle, at + 1);
    return { line: 0, ch: at + 2 };
}

const keys: [string, (plugin: FootnotePlugin) => Promise<void>][] = [
    ["numbered", insertAutonumFootnote],
    ["named", insertNamedFootnote],
    ["inline", insertInlineFootnote],
    ["paste", pasteInlineFootnote],
];

async function press(command: (plugin: FootnotePlugin) => Promise<void>, carets: { line: number; ch: number }[]) {
    const doc = fakeEditor([...NOTE], { carets, edits: true, wholeDoc: true, words: true });
    await command(fakePlugin(settings, doc));
    return doc;
}

beforeEach(resetNotices);

describe("every caret inside a footnote, the press refused: the notice says where the carets are", () => {
    for (const [key, command] of keys) {
        it.each([
            ["a reference and an inline footnote", [inside("[^a]"), inside("^[x]")]],
            ["references of different names", [inside("[^a]"), inside("[^b]")]],
            ["a reference with no definition and one with", [inside("[^c]"), inside("[^a]")]],
            ["a filled inline footnote and an empty one", [inside("^[x]"), inside("^[]")]],
            ["both in a reference whose footnote has a definition", [inside("[^a]"), inside("[^a]", 1)]],
        ])(`${key} key, %s`, async (_what, carets) => {
            const doc = await press(command, carets);
            expect(doc.lines).toEqual(NOTE);
            expect(messages()).toEqual([MultiCaretInFootnotesNotice]);
        });
    }

    it("paste key, both in references of one name with no definition", async () => {
        const doc = await press(pasteInlineFootnote, [inside("[^c]"), inside("[^c]", 1)]);
        expect(doc.lines).toEqual(NOTE);
        expect(messages()).toEqual([MultiCaretInFootnotesNotice]);
    });

    it("the notice reads as drafted", () => {
        expect(MultiCaretInFootnotesNotice).toBe("No footnotes were created: the carets are inside existing footnotes. Move them into the text.");
    });
});

describe("controls", () => {
    it.each(keys)("%s key, one caret in a reference and one on plain text: the nesting notice stays", async (_key, command) => {
        const doc = await press(command, [inside("[^a]"), inside("plain")]);
        expect(doc.lines).toEqual(NOTE);
        expect(messages()).toEqual([MultiCaretNestedNotice]);
    });

    it("numbered key, both in references of one name with no definition: the definition is made", async () => {
        const doc = await press(insertAutonumFootnote, [inside("[^c]"), inside("[^c]", 1)]);
        expect(doc.lines).toContain("[^c]: ");
        expect(messages()).toEqual([]);
    });
});
