import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { carryRegister, handleCopy, handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output, up to data loss): a copied or cut span that is no
// definition where it sits in the note, but reads as one when the
// selected text stands alone, is carried as a definition.
//
// What the user would see: a few shapes of one mistake.
// - "[^1]: to define" copied out of the middle of the sentence "Use
//   [^1]: to define, see[^1]." and pasted mid-line elsewhere: the words
//   never appear at the caret; instead the note gains "[^1]: to define"
//   and "[^1]: one" at the bottom, [^1] defined twice. Cut and pasted
//   straight back, the sentence stays gutted ("Use , see[^1].") and two
//   renamed definitions "[^2]" appear at the bottom.
// - " [^98]:" copied from inside a "%%" comment and pasted after "Host
//   line " adds an empty definition "[^1]: " at the bottom, and nothing
//   at the caret.
// - A label inside a "%%" block comment, or on the comment's closer line,
//   cut and pasted back at the same spot lands outside the comment as a
//   live definition (renamed); with the closer line, the comment stays
//   open to the end of the note and hides the definitions below.
// - A lazy label (a "[^x]: ..." line right under a paragraph or a list
//   item's text, which Obsidian reads as more of that paragraph, not as a
//   definition) copied and pasted over itself, or cut and pasted back, is
//   lifted out of its paragraph and lands among the definitions.
// - The closer line of a "%%" block, copied from the end of the opener
//   and pasted over itself, lifts the closer out of the comment, so the
//   opener has no closer and hides the rest of the note.
//
// Hunt 2026-10-06, cycle 5, lens carry and round trip. Cluster X7.
//
// Origin: pre-existing.
//
// Source of truth: the note reading where the text was copied from (the
// span holds no definition there: text inside a comment, mid-sentence
// text, or a lazy label, docs/obsidian-reading-rules.md B4 and ruling A1),
// the README's Paste paragraph (the text lands at the caret; definitions
// travel only for the footnotes the text needs), and the round trip: copy
// then paste over the same selection, or cut then paste back, gives the
// note back.
//
// Cause: remember() in src/commands/carry-footnotes-hooks.ts splits the
// bare selection with splitCarriedText(selected, true), which reads the
// selected text on its own, where such a line is a definition. The
// register then holds an empty or shortened body and carries the line as
// a definition, and the paste appends it at the bottom.

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
const settings = { carryFootnotesOnCopy: true, enableRemoveBlankLastLines: false, enableFootnoteSectionHeading: false, footnoteSectionHeading: "# Footnotes", removeEmptySectionHeading: false, lintOnFootnoteCreation: false };

/** A line and a character in it. */
type Pos = { line: number; ch: number };

/** A fake editor holding `lines`, with the selection running from `from` to `to` (a bare caret when `to` is left out). */
const editor = (lines: string[], from: Pos, to = from) => fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });

/** The text between `from` and `to` in `lines`. */
function sliceText(lines: string[], from: Pos, to: Pos): string {
    if (from.line === to.line) return lines[from.line].slice(from.ch, to.ch);
    return [lines[from.line].slice(from.ch), ...lines.slice(from.line + 1, to.line), lines[to.line].slice(0, to.ch)].join("\n");
}

/** `lines` with the text between `from` and `to` replaced by `text`, as the editor's own paste or cut leaves them. */
function replaced(lines: string[], from: Pos, to: Pos, text: string): string[] {
    const joined = lines[from.line].slice(0, from.ch) + text + lines[to.line].slice(to.ch);
    return [...lines.slice(0, from.line), ...joined.split("\n"), ...lines.slice(to.line + 1)];
}

/** The clipboard text a copy of `from` to `to` leaves: the plugin's, or the editor's own when the plugin leaves the copy alone. */
function copy(lines: string[], from: Pos, to: Pos): string {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCopy(fakePlugin(settings, doc), event as never);
    return event.defaultPrevented ? event.written["text/plain"] : sliceText(lines, from, to);
}

/** Cuts from..to out of a note holding `lines`; returns the note, the clipboard text, whether the plugin took the cut, and the caret after it (the editor's own cut when the plugin left it alone). */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = editor(lines, from, to);
    const event = clipboardEvent();
    handleCut(fakePlugin(settings, doc), event as never);
    const taken = event.defaultPrevented;
    return {
        lines: taken ? doc.lines.slice() : replaced(lines, from, to, ""),
        clip: taken ? event.written["text/plain"] : sliceText(lines, from, to),
        taken,
        caret: taken ? doc.cursor : from,
    };
}

/** Pastes `clip` over `at`..`to` in a note holding `lines`; returns the note (the editor's own paste when the plugin leaves it alone) and whether the plugin took the paste over. */
function paste(lines: string[], at: Pos, clip: string, to: Pos = at) {
    const doc = editor(lines, at, to);
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(settings, doc), event as never, doc);
    const taken = event.defaultPrevented;
    return { lines: taken ? doc.lines.slice() : replaced(lines, at, to, clip), taken };
}

/** Copies `from`..`to` and pastes the clipboard back over the same selection; returns the note. */
function copyOverItself(note: string[], from: Pos, to: Pos): string[] {
    return paste(note, from, copy(note, from, to), to).lines;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a span copied out of a sentence or a comment is carried as a definition", () => {
    it.fails("'[^1]: to define' cut out of a sentence and pasted back into its own line gives the sentence back", () => {
        const source = ["Use [^1]: to define, see[^1].", "", "[^1]: one"];
        const c = cut(source, { line: 0, ch: 4 }, { line: 0, ch: 19 });
        const back = paste(c.lines, { line: 0, ch: 4 }, c.clip);
        // Today: ["Use , see[^1].", "", "[^1]: one", "[^2]: to define", "[^2]: one"]
        expect(back.lines, JSON.stringify({ c, register: carryRegister(), back, toasts: messages() })).toEqual(source);
    });

    it.fails("'[^1]: to define' copied out of a sentence, pasted mid-line elsewhere, stays at the caret as text; only [^1]'s real definition travels", () => {
        const source = ["Use [^1]: to define, see[^1].", "", "[^1]: one"];
        const clip = copy(source, { line: 0, ch: 4 }, { line: 0, ch: 19 });
        const back = paste(["dest abc def"], { line: 0, ch: 8 }, clip);
        const ctx = JSON.stringify({ clip, register: carryRegister(), back, toasts: messages() });
        expect(back.taken, ctx).toBe(true);
        // Today: ["dest abc def", "", "[^1]: to define", "[^1]: one"]
        expect(back.lines, ctx).toEqual(["dest abc[^1]: to define def", "", "[^1]: one"]);
    });

    it.fails("' [^98]:' copied from inside a %% comment and pasted after 'Host line ' lands at the caret, adds no definition", () => {
        const source = ["%% [^98]: inline comment label %%"];
        // the comment line defines nothing
        expect(readNote(source).definitions).toEqual([]);
        const clip = copy(source, { line: 0, ch: 2 }, { line: 0, ch: 9 });
        expect(clip).toBe(" [^98]:");
        const host = ["", "Host line ", "", "%% [^98]: inline comment label %%"];
        const back = paste(host, { line: 1, ch: 10 }, clip);
        const ctx = JSON.stringify({ register: carryRegister(), back, toasts: messages() });
        // Today "[^1]: " is appended at the bottom and nothing lands at the caret.
        expect(readNote(back.lines).definitions.length, ctx).toBe(0);
        expect(back.lines[1], ctx).toBe("Host line  [^98]:");
    });
});

describe("a line that is no definition in the note, cut and pasted back at the same spot", () => {
    it.fails("a label inside a %% block comment stays inside the comment, as it was", () => {
        const note = ["Text[^1].", "", "%%", "[^1]: commented out", "%%", "", "End."];
        // ruling A1: a label inside a comment defines nothing; [^1] is a live reference
        expect(readNote(note).definitions).toEqual([]);
        const c = cut(note, { line: 3, ch: 0 }, { line: 4, ch: 0 });
        // nothing to carry, so the cut is the editor's own
        expect(c.taken).toBe(false);
        expect(c.lines).toEqual(["Text[^1].", "", "%%", "%%", "", "End."]);
        const back = paste(c.lines, c.caret, c.clip);
        // Today the plugin appends "[^2]: commented out" after "End." as a live definition, leaving "%%" "%%".
        expect(back.lines, JSON.stringify({ c, back, toasts: messages() })).toEqual(note);
    });

    it.fails("a label on the comment's closer line ('[^1]: text %%'), cut and pasted back: the closer comes back where it was", () => {
        const note = ["Text[^1]. Other[^2].", "", "%%", "[^1]: before the closer %%", "", "[^2]: two"];
        // the label sits inside the comment, before its closer: no definition; [^2] is defined
        expect(readNote(note).definitions.map((d) => d.name)).toEqual(["2"]);
        const c = cut(note, { line: 3, ch: 0 }, { line: 4, ch: 0 });
        expect(c.taken).toBe(false);
        // the cut took the closer, so the comment now runs to the end and hides [^2]
        expect(readNote(c.lines).definitions).toEqual([]);
        const back = paste(c.lines, c.caret, c.clip);
        const ctx = JSON.stringify({ c, back, toasts: messages() });
        // Today the line lands ABOVE the "%%" opener, renamed to [^3], so the
        // comment stays open to the end of the note and [^2]'s definition stays hidden.
        expect(readNote(back.lines).definitions.map((d) => d.name), ctx).toContain("2");
        expect(back.lines, ctx).toEqual(note);
    });

    it.fails("a lazy label (plain text under a paragraph), cut and pasted back, stays the text it was", () => {
        const note = ["Para one.", "[^1]: lazy label text", "", "Para two."];
        // a label right under a paragraph line is lazy text: no definition, a live [^1] reference
        expect(readNote(note).definitions).toEqual([]);
        const c = cut(note, { line: 1, ch: 0 }, { line: 2, ch: 0 });
        expect(c.taken).toBe(false);
        const back = paste(c.lines, c.caret, c.clip);
        // Today the plugin appends "[^1]: lazy label text" after "Para two." as a definition.
        expect(back.lines, JSON.stringify({ c, back, toasts: messages() })).toEqual(note);
    });
});

describe("a line that is no definition in the note, copied and pasted over itself", () => {
    it.fails("a lazy label under a paragraph", () => {
        const note = ["Para.", "[^x]: lazy text"];
        // Today: ["Para.", "", "", "[^x]: lazy text"]
        expect(copyOverItself(note, { line: 1, ch: 0 }, { line: 1, ch: 15 })).toEqual(note);
    });

    it.fails("a lazy label under a list item's text, copied in part", () => {
        const note = ["- item[^91]", "  [^91]: lazy under a list item"];
        // Today: ["- item[^91]", "azy under a list item", "", "[^1]: l"]
        expect(copyOverItself(note, { line: 1, ch: 0 }, { line: 1, ch: 10 })).toEqual(note);
    });

    it.fails("a lazy label under a paragraph the table under '<3' belongs to", () => {
        const note = ["Text[^n].", "", "<3", "| a | b |", "| --- | --- |", "[^120]: d", "", "[^n]: en"];
        expect(copyOverItself(note, { line: 5, ch: 0 }, { line: 5, ch: 9 })).toEqual(note);
    });

    it.fails("the closer line of a %% block, copied from the end of the opener through the closer line, stays in its comment", () => {
        const note = ["%%", "[^114]: before closer %%", "", "Text[^n].", "", "[^n]: en"];
        expect(copyOverItself(note, { line: 0, ch: 2 }, { line: 2, ch: 0 })).toEqual(note);
    });
});
