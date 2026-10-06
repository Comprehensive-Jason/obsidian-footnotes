import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carriedInputHandler, handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a carried paste right above a definition's label
// does not reuse that definition; it adds a renamed copy, or points the
// pasted reference at a hidden copy.
//
// What the user would see: the note reads "Para one[^1].", an empty line,
// and "[^1]: one". The user copies the first line and pastes it on the
// empty line. The plugin keeps the definition a definition (it adds a
// blank line after the pasted text), but the pasted reference comes out
// as [^2] with a second definition "[^2]: one", where the README promises
// the note's own "[^1]: one" is reused. The same happens through a phone
// keyboard's clipboard history, and with a line-wise copy pasted at the
// start of the label's line. Where the note defines [^1] twice ("one",
// then "two", which is the one Obsidian shows), a paste of "See[^1]."
// with "[^1]: one" right above the shown copy is pointed at [^1] and
// counted as reused, so it shows "two".
//
// Hunt 2026-10-06, cycle 4, lens carry. Cluster K1.
//
// Origin: regression (since ea38e82, from 7541847 with ef9a374).
//
// Source of truth: the README's Paste paragraph ("A definition the
// destination already has (same text, whatever its name) is reused");
// the pasted text with the blank line the plugin adds after it, as the
// note then reads it (the label is a definition again).
//
// Cause: landCarriedText in src/commands/carry-footnotes-hooks.ts hands
// planCarriedPaste the text asOwnParagraph returns (landing.text) but not
// the blank line it adds after it (landing.after). The planner reads the
// note with the text landed and that blank line missing, so the label
// right under the text reads as more of its paragraph (a lazy label: a
// label-shaped line that Obsidian reads as plain text, since there is no
// blank line above it). The definition the paste should reuse is then no
// definition, and a hidden first copy is the only [^1] the planner sees.

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
type Pos = { line: number; ch: number };

/** Copies from..to out of a note holding `lines`; returns the clipboard text the plugin wrote. */
function copy(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCopy(fakePlugin(settings, doc), event as never);
    return event.written["text/plain"];
}

/** Pastes `clip` into a note holding `lines` with the caret at `at`; returns the note and whether the plugin took the paste over. */
function paste(lines: string[], at: Pos, clip: string) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at } });
    const event = clipboardEvent(clip);
    handlePaste(fakePlugin(settings, doc), event as never, doc);
    return { lines: doc.lines.slice(), taken: event.defaultPrevented };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("bug: the paste planner reads the label right under the pasted text as lazy", () => {
    it.fails("copy a sentence and paste it on the empty line right above its own definition reuses the definition", () => {
        const note = ["Para one[^1].", "", "[^1]: one"];
        const clip = copy(note, { line: 0, ch: 0 }, { line: 0, ch: 13 });
        expect(clip).toBe("Para one[^1].\n\n[^1]: one");
        const back = paste(note, { line: 1, ch: 0 }, clip);
        expect(back.taken).toBe(true);
        // Today the note reads "Para one[^1].", "Para one[^2].", "",
        // "[^1]: one", "[^2]: one".
        expect(back.lines.filter((line) => /^\[\^\w+\]: one$/.test(line))).toEqual(["[^1]: one"]);
        expect(back.lines.join("\n")).not.toContain("[^2]");
    });

    it.fails("a line-wise copy pasted at the start of its definition's label line reuses the definition", () => {
        // the text ends in a line break, and the caret is at column 0 of the label
        const note = ["Text[^2].", "", "[^2]: beta"];
        const clip = copy(note, { line: 0, ch: 0 }, { line: 1, ch: 0 });
        const back = paste(note, { line: 2, ch: 0 }, clip);
        expect(back.taken).toBe(true);
        // Today "[^1]: beta" is added and the pasted reference is [^1].
        expect(back.lines.filter((line) => line.endsWith(": beta"))).toEqual(["[^2]: beta"]);
    });

    it.fails("a paste right above the shown copy of a name defined twice is not merged into the hidden first copy", () => {
        // [^1] is defined twice; Obsidian shows the last, "two". The pasted
        // [^1] "one" (from another note) must not be pointed at [^1],
        // which shows "two" after the paste.
        const note = ["A[^1]", "", "[^1]: one", "", "Intro.", "", "[^1]: two"];
        const back = paste(note, { line: 5, ch: 0 }, ["See[^1].", "", "[^1]: one"].join("\n"));
        expect(back.taken).toBe(true);
        // Today the pasted line reads "See[^1]." and the toast says "1 reused".
        expect(back.lines).not.toContain("See[^1].");
    });

    it.fails("through the keyboard's clipboard history: text committed on the empty line right above its own definition reuses the definition", () => {
        const note = ["Para one[^1].", "", "[^1]: one"];
        const doc = fakeEditor(note, { wholeDoc: true, edits: true, cursor: { line: 1, ch: 0 } });
        const handle = carriedInputHandler(fakePlugin(settings, doc), () => doc);
        const at = doc.posToOffset({ line: 1, ch: 0 });
        expect(handle({} as never, at, at, ["Para one[^1].", "", "[^1]: one"].join("\n"))).toBe(true);
        expect(doc.lines.filter((line) => line.endsWith(": one"))).toEqual(["[^1]: one"]);
    });
});
