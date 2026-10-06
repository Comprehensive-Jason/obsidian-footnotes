import { beforeEach, describe, expect, it } from "vitest";

import { insertInTableCell } from "../../src/commands/create-footnote";
import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import type { TableCellEditor } from "../../src/editor/table-cursor";
import { drawnAsLink } from "../../src/parsing/landing";
import { readNote } from "../../src/parsing/note-reading";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";

// BUG (wrong output): with "Insert at end of word" off, a press with the
// caret inside a bare email address or web address writes the footnote
// there and cuts the address short, so the link points somewhere else.
//
// A "bare" address is one typed as plain text, "bob@example.com" or
// "https://e.com", which Reading view turns into a link on its own.
//
// What the user would see: in "contact bob@example.com today", with the
// caret right after the "b", a numbered press writes
// "contact b[^1]ob@example.com today". Reading view now links
// "ob@example.com", a different address. In "see https://e.com/[t](u) end"
// a press in "https" writes "see ht[^1]tps://e.com/[t](u) end", and the web
// address is no longer a link at all; only "[t](u)" is. The same happens
// in a table cell, and with a multi-caret press whose carets a lone press
// would refuse one by one. Every other caret inside a link is refused with
// the link notice ("No footnote was created: Obsidian would read it as part
// of a link.").
//
// Hunt 2026-10-06, cycle 5, lens press. Cluster X3.
//
// Origin: pre-existing.
//
// Source of truth: live Obsidian 1.14.4 (2026-10-06): in
// "contact b[^1]ob@example.com today" Reading view links "ob@example.com"
// (mailto:ob@example.com); in "see ht[^1]tps://e.com/[t](u) end" the only
// link drawn is "[t](u)". README ("Nor are they written ... where Obsidian
// would read them as part of a link"). A sibling of the fixed pin
// bug-press-between-image-bang-and-bracket (hunt cycle 4), which had the
// same cause for images and embeds.
//
// Cause: the check that refuses a press inside a link (pressLineVerdict
// and fewerLinksDrawn in src/editor/insertion-liveness.ts, and the table
// cell's twin of it) counts how many links the line draws before and
// after the press. An address cut to a shorter address, or an address that
// ran on into "[t](u)" and now leaves "[t](u)" drawn alone, is still one
// link drawn, so nothing looks lost. The check should compare which links
// are drawn, not how many.

beforeEach(resetNotices);

const EndOfWordOff = {
    insertAtEndOfWord: false,
    footnotePlacement: "after" as const,
    enablePopupEditor: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "",
    enableRemoveBlankLastLines: false,
    lintOnFootnoteCreation: false,
};

/** The text of every link the note draws, sorted. */
function drawnLinks(lines: string[]): string[] {
    const r = readNote(lines);
    return r.links
        .filter((l) => drawnAsLink(l, r.linkLabels))
        .map((l) => lines[l.startLine].slice(l.start, l.end))
        .sort();
}

// Each test accepts a refusal (the note left as it was) or a press that
// keeps every link pointing where it pointed.
describe("a press inside a bare address never changes where it points", () => {
    // Now: "contact b[^1]ob@example.com today", which links "ob@example.com".
    it("autonum, end of word off: caret after the 'b' of 'bob@example.com'", async () => {
        const lines = ["contact bob@example.com today"];
        const doc = fakeEditor([...lines], { cursor: { line: 0, ch: 9 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(EndOfWordOff, doc));
        if (doc.lines.join("\n") === lines.join("\n")) return;
        expect(drawnLinks(doc.lines), JSON.stringify({ out: doc.lines, notices: messages() })).toEqual(drawnLinks(lines));
    });

    // Now: "see ht[^1]tps://e.com/[t](u) end": the web address is gone and
    // "[t](u)" is drawn alone.
    it("autonum, end of word off: caret in the scheme of an address that runs into a link", async () => {
        const lines = ["see https://e.com/[t](u) end"];
        const doc = fakeEditor([...lines], { cursor: { line: 0, ch: 6 }, edits: true, wholeDoc: true, words: true });
        await insertAutonumFootnote(fakePlugin(EndOfWordOff, doc));
        if (doc.lines.join("\n") === lines.join("\n")) return;
        expect(drawnLinks(doc.lines), JSON.stringify({ out: doc.lines, notices: messages() })).toEqual(drawnLinks(lines));
    });

    // A table cell is edited in its own small editor; this object stands in
    // for it. Now: the cell press writes "b[^1]ob@example.com".
    it("table cell, end of word off: caret after the 'b' of 'bob@example.com' is refused", () => {
        const dispatched: { changes?: { from: number } }[] = [];
        const cell = {
            state: { doc: { toString: () => "bob@example.com" }, selection: { main: { head: 1, anchor: 1 } } },
            dispatch: (spec: { changes?: { from: number } }) => dispatched.push(spec),
        } as unknown as TableCellEditor;
        const wrote = insertInTableCell(cell, fakePlugin(EndOfWordOff), "[^1]", 4);
        expect({ wrote, dispatched: dispatched.length }).toEqual({ wrote: false, dispatched: 0 });
    });

    // A lone press at ch 10 is refused. Now: "[^1]h[^1]ttps://e.[^1]coma@b.co":
    // the first two references break the web address, so the third comes
    // out live, and the line now links the email "coma@b.co".
    it("multi-caret, end of word off: carets at ch 0, 1, and 10 of 'https://e.coma@b.co'", async () => {
        const lines = ["https://e.coma@b.co", "Wow", ""];
        const doc = fakeEditor([...lines], {
            carets: [
                { line: 0, ch: 10 },
                { line: 0, ch: 0 },
                { line: 0, ch: 1 },
            ],
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(fakePlugin(EndOfWordOff, doc));
        if (doc.lines.join("\n") === lines.join("\n")) return;
        expect(drawnLinks(doc.lines), JSON.stringify({ out: doc.lines, notices: messages() })).toEqual(drawnLinks(lines));
    });
});
