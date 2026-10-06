import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): a line-wise paste at the start of a definition's
// label, right under another definition, becomes the first definition's
// text.
//
// What the user would see: the note ends "[^1]: a" with "[^2]: b" right
// under it. The user puts the caret at the start of "[^2]: b" and pastes
// a paragraph copied line-wise (it ends in a line break), "See[^3]." with
// its definition "[^3]: c". The note then reads "[^1]: a", "See[^3].",
// "[^2]: b": the pasted paragraph is read as more of [^1]'s text (a lazy
// continuation: a line that carries on the paragraph above it without
// being indented), so the footnote [^1] now holds a reference to [^3],
// a footnote inside a footnote.
//
// Hunt 2026-10-06, cycle 4, lens carry. Cluster K3.
//
// Origin: pre-existing.
//
// Source of truth: ADR 0001 (no nested footnotes), and asOwnParagraph's
// own comment in src/commands/carry-footnotes-hooks.ts: a paste made
// outside a definition that would be read as part of one gets a blank
// line in front.
//
// Cause: asOwnParagraph asks insideDefinition(before, at.line) on the note
// before the paste, and a caret at column 0 of "[^2]: b" sits on a
// definition's line, so the paste counts as made inside a definition and
// gets no blank line in front. Once the text lands, that line is no longer
// [^2]'s; it carries on [^1]'s paragraph. ef9a374 fixed only the blank
// line after the text, for the label the paste pushes down.

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clipboardEvent(text = "") {
    const event = {
        written: {} as Record<string, string>,
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

describe("bug: a line-wise paste at column 0 of a label right under another definition", () => {
    it("the pasted paragraph stays its own paragraph, not [^1]'s lazy continuation", () => {
        const note = ["Body[^1] and[^2].", "", "[^1]: a", "[^2]: b"];
        // a line-wise copy: the text ends in a line break, then the carried definition
        const back = paste(note, { line: 3, ch: 0 }, ["See[^3].", "", "", "[^3]: c"].join("\n"));
        expect(back.taken).toBe(true);
        const pasted = back.lines.indexOf("See[^3].");
        expect(pasted).toBeGreaterThan(0);
        // Today the note reads "[^1]: a", "See[^3].", "[^2]: b", "[^3]: c",
        // and [^1]'s definition runs over the pasted line.
        const one = readNote(back.lines).definitions.find((d) => d.name === "1");
        expect(one && one.end).toBeLessThan(pasted);
        expect(messages().join(" ")).not.toContain("nested");
    });
});
