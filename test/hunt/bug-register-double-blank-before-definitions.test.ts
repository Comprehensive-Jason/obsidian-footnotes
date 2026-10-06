import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carryRegister, handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a copied selection with two blank lines between its
// text and its own definition splits the line it is pasted into.
//
// What the user would see: the note reads "See[^1].", two blank lines,
// and "[^1]: one". The user selects all of it, ending right after "one",
// copies, and pastes in the middle of "dest abc def". The pasted text
// should sit inside that line ("dest abcSee[^1]. def") with [^1]'s
// definition at the bottom; instead the line is split after "See[^1].",
// and " def" lands on a line of its own. A selection that runs to the
// start of the line after the definition, pasted at the start of a line,
// leaves a stray blank line before that line.
//
// Hunt 2026-10-06, cycle 5, lens carry. Cluster X12.
//
// Origin: pre-existing (cycle 4's cluster K2, pin
// bug-own-copy-double-blank-definitions-split-line, fixed the same
// symptom for two blank lines between two definitions; this is the gap
// between the text and the first definition).
//
// Source of truth: the selection itself (it holds no line break after
// "See[^1]." other than the spacing before its definition), and 52d0c07's
// ruling for cluster K2: the blank lines in front of a selection's own
// definitions are the note's spacing, never a line break of the
// selection's, so pasted mid-line the text stays inside the line.
//
// Cause: splitCarriedText in src/commands/carry-footnotes.ts, called with
// `selection` true by remember(), drops exactly one blank line in front of
// the first trailing definition (`bodyEnd`) and leaves any more on the end
// of the register's body, which the paste then writes as line breaks.

interface FakeClipboardEvent {
    clipboardData: { getData(type: string): string; setData(type: string, value: string): void; types: string[] };
    preventDefault(): void;
    stopPropagation(): void;
    defaultPrevented: boolean;
    written: Record<string, string>;
}

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clipboardEvent(text = ""): FakeClipboardEvent {
    const event: FakeClipboardEvent = {
        written: {},
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
const settings = { carryFootnotesOnCopy: true, enableRemoveBlankLastLines: true, enableFootnoteSectionHeading: false, footnoteSectionHeading: "# Footnotes", removeEmptySectionHeading: false, lintOnFootnoteCreation: false };

/** A line and a character in it. */
type Pos = { line: number; ch: number };

/** A fake editor holding `lines`, with the selection running from `from` to `to` (a bare caret when `to` is left out). */
const editor = (lines: string[], from: Pos, to = from) => fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });

/** The clipboard text a copy of `from` to `to` leaves: the plugin's, or the editor's own when the plugin leaves the copy alone. */
function copy(lines: string[], from: Pos, to: Pos): string {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCopy(fakePlugin(settings, doc), event as never);
    if ("text/plain" in event.written) return event.written["text/plain"];
    const picked = lines.slice(from.line, to.line + 1);
    picked[picked.length - 1] = picked[picked.length - 1].slice(0, to.ch);
    picked[0] = picked[0].slice(from.ch);
    return picked.join("\n");
}

/** Pastes `clip` at `at` in a note holding `lines`; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], at: Pos, clip: string) {
    const doc = editor(lines, at);
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(settings, doc), event as never, doc);
    return { lines: doc.lines.slice(), taken: event.defaultPrevented };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("two blank lines between a copied text and its own definition", () => {
    const source = ["See[^1].", "", "", "[^1]: one"];

    it.fails("a selection ending right after 'one' (no line break) pasted mid-line keeps the text inside the line", () => {
        const clip = copy(source, { line: 0, ch: 0 }, { line: 3, ch: 9 });
        const back = paste(["dest abc def"], { line: 0, ch: 8 }, clip);
        expect(back.taken).toBe(true);
        // Today the line is split after "See[^1]." and " def" lands on a line of its own.
        expect(back.lines, JSON.stringify({ clip, register: carryRegister() })).toEqual(["dest abcSee[^1]. def", "", "[^1]: one"]);
    });

    it.fails("the register's text for that selection holds no line break", () => {
        copy(source, { line: 0, ch: 0 }, { line: 3, ch: 9 });
        // Today: "See[^1].\n"
        expect(carryRegister()?.body).toBe("See[^1].");
    });

    it.fails("a line-wise selection ending at the start of the line after the definition, pasted at a line start, ends its own line once", () => {
        const withTail = [...source, "tail"];
        const clip = copy(withTail, { line: 0, ch: 0 }, { line: 4, ch: 0 });
        const back = paste(["dest", "x"], { line: 1, ch: 0 }, clip);
        expect(back.taken).toBe(true);
        // Today: ["dest", "See[^1].", "", "x", "", "[^1]: one"]
        expect(back.lines, JSON.stringify({ clip, register: carryRegister() })).toEqual(["dest", "See[^1].", "x", "", "[^1]: one"]);
    });
});
