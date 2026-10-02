import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (annoyance): after a cut that also removes a definition sitting
// ABOVE the selection, the caret lands lines below where the selection
// was, or past the end of the note.
//
// What the user would see: the note has "[^a]: alpha" under "# Chapter
// 1" and the only "[^a]" reference further down, under "# Chapter 2".
// They cut "[^a]" from "Text[^a] more". The definition goes with it, as
// it should, but the caret does not stay between "Text" and " more": it
// jumps two lines down, here beyond the last line of the note.
//
// Hunt 2026-10-02, round 1, lens carry-hook. Cluster C7.
//
// Source of truth: docs/agents/dev-setup.md: Obsidian resolves positions
// against the document as it reads after the change. A cut leaves the
// caret where the selection was.
//
// Cause: handleCut ends with doc.setCursor(from), and `from` is the
// selection's start in the note as it read BEFORE the cut. Removing a
// definition block above the selection moves every line below it up, so
// that old line number now points further down the note.

/** A stand-in for the browser's clipboard event: it records what the hook writes and whether the hook took the event over. */
function clipboardEvent() {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: () => "",
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

/** A fake editor holding `lines`, with the selection running from `from` to `to`. */
function editor(lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("cut: the caret afterwards", () => {
    it.fails("puts the caret where the selection was when an orphaned definition ABOVE it was removed", () => {
        const lines = ["# Chapter 1", "", "[^a]: alpha", "", "# Chapter 2", "", "Text[^a] more"];
        const doc = editor(lines, { line: 6, ch: 4 }, { line: 6, ch: 8 });
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), clipboardEvent() as never);
        expect(doc.lines).toEqual(["# Chapter 1", "", "# Chapter 2", "", "Text more"]);
        expect(doc.cursor).toEqual({ line: 4, ch: 4 });
    });

    // A variant from round 2 (lens interactions, cluster I5): the cut takes
    // the only footnote's last reference, so the definition goes, the
    // section is empty, and Remove empty section heading takes the heading
    // and the blank lines above it, the cut's own emptied line among them.
    // The note is left as "intro" alone, and the caret is left on line 2,
    // past the end of the note.
    it.fails("keeps the caret inside the note when the heading removal takes the cut's own (now blank) line", () => {
        const lines = ["intro", "", "a[^1] b", "", "# Footnotes", "", "[^1]: one"];
        const doc = editor(lines, { line: 2, ch: 0 }, { line: 2, ch: 7 });
        const plugin = fakePlugin(
            {
                carryFootnotesOnCopy: true,
                enableFootnoteSectionHeading: true,
                footnoteSectionHeading: "# Footnotes",
                removeEmptySectionHeading: true,
                enableRemoveBlankLastLines: true,
            },
            doc,
        );
        handleCut(plugin, clipboardEvent() as never);
        expect(doc.lines).toEqual(["intro"]);
        expect(doc.cursor.line).toBeLessThan(doc.lines.length);
    });

    // A variant from round 3 (lens carry-model): the same thing at default
    // settings, with no section heading at all. Cutting the whole line
    // "Only[^1] here." orphans the definition, so it goes, and Remove blank
    // last lines then takes the blank lines left behind, the cut's own
    // emptied line among them. The note is left as "Intro." alone, and the
    // caret is left on line 2, past the end of the note.
    it.fails("keeps the caret inside the note when the cut's own emptied line is trimmed away at default settings", () => {
        const lines = ["Intro.", "", "Only[^1] here.", "", "[^1]: one"];
        const doc = editor(lines, { line: 2, ch: 0 }, { line: 2, ch: 14 });
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), clipboardEvent() as never);
        expect(doc.lines).toEqual(["Intro."]);
        // Today: { line: 2, ch: 0 }.
        expect(doc.cursor.line).toBeLessThan(doc.lines.length);
    });
});
