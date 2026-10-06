import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { planCarriedPaste } from "../../src/commands/carry-footnotes";

// BUG (wrong output): a paste never reuses a definition of two or more
// lines that sits in a blockquote, so it adds a second copy of it.
//
// What the user would see: a note has a footnote whose definition sits
// in a blockquote and runs over two lines ("> [^q]: one" and "> two").
// The user copies text that cites it and pastes it elsewhere in the same
// note. Instead of the pasted reference pointing at the footnote the
// note already has, the paste adds a new footnote with the same text
// under a new name, so the note holds the same footnote twice.
//
// Hunt 2026-10-06, cycle 3, lens carry. Cluster K5.
//
// Origin: pre-existing.
//
// Source of truth: the README's Paste paragraph ("A definition the
// destination already has (same text, whatever its name) is reused").
// A one-line quoted definition is reused today; only the lines after a
// quoted label miss.
//
// Cause: planCarriedPaste in src/commands/carry-footnotes.ts keys each
// definition the destination shows by normalisedBody of its raw lines.
// For a quoted definition the second line still starts with the quote's
// ">" marker (a marker is the ">" or "- " in front of a quoted or listed
// line), so the key reads "one > two", while the carried block, lifted
// out of the quote, reads "one two". The two never match.

type Pos = { line: number; ch: number };

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clip(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (t: string) => (t === "text/plain" ? text : ""),
            setData: (t: string, v: string) => {
                event.written[t] = v;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

/** Pastes `text` into a note holding `dest` with the caret at `at`; returns the note's lines. */
function paste(dest: string[], at: Pos, text: string) {
    const doc = fakeEditor(dest, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, doc), clip(text) as never, doc);
    return doc.lines;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("bug: a two-line quoted definition is never reused by a paste", () => {
    it.fails("text citing a two-line quoted definition, copied and pasted in the same note, reuses that definition", () => {
        const note = ["See[^q] here.", "", "> [^q]: one", "> two", "", "End."];
        const src = fakeEditor(note, { wholeDoc: true, edits: true, cursor: { line: 0, ch: 0 }, selection: { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 7 } } });
        const ev = clip();
        handleCopy(fakePlugin({ carryFootnotesOnCopy: true }, src), ev as never);
        const out = paste(note, { line: 5, ch: 4 }, ev.written["text/plain"]);
        // Today the paste lands "See[^q-2]" and appends a second definition with the same text.
        expect(out).toEqual(["See[^q] here.", "", "> [^q]: one", "> two", "", "End.See[^q]"]);
    });

    it.fails("reuses a quoted definition whose text is the same as the carried one (README: same text, whatever its name)", () => {
        const dest = ["Text[^q].", "", "> [^q]: one", "> two"];
        const plan = planCarriedPaste(dest.join("\n"), "x[^1]", [{ name: "1", lines: ["[^1]: one", "two"] }], { line: 0, ch: 9 });
        expect({ reused: plan.reused, body: plan.body }).toEqual({ reused: 1, body: "x[^q]" });
    });
});
