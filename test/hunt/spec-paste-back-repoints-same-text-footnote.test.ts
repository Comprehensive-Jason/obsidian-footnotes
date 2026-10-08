import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: two footnotes with the same text ("Ibid."): when the
// paragraph citing the second is cut and pasted straight back, should it
// get its own footnote back, or share the first one's?
//
// What it does now: the note reads "First[^a].", "Second[^b].",
// "[^a]: Ibid.", "[^b]: Ibid.". Cutting the line "Second[^b]." takes
// "[^b]: Ibid." out with it (nothing else cites it). Pasting straight
// back at the caret finds "[^a]: Ibid." already in the note with the same
// text and reuses it: the paragraph comes back as "Second[^a]." and
// "[^b]: Ibid." is gone.
// What a user might expect: the note comes back exactly as it was, two
// footnotes, since a cut and a paste back is an undo by hand.
// Why it is a question and not a bug: the README permits it: "A
// definition the destination already has (same text, whatever its name)
// is reused". The reader sees the same footnote text either way. An
// "Ibid." footnote's meaning depends on where it sits, though, so whether
// look-alike short footnotes should be merged on paste is Jason's call.
//
// Hunt 2026-10-06, cycle 4, lens round trip. Cluster RT3.
//
// Origin: pre-existing.
//
// Source of truth: the README's Paste paragraph (quoted above).

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
const settings = { carryFootnotesOnCopy: true, enableFootnoteSectionHeading: false, footnoteSectionHeading: "# Footnotes", removeEmptySectionHeading: false, lintOnFootnoteCreation: false };
type Pos = { line: number; ch: number };

/** Cuts from..to out of a note holding `lines`; returns the note, the clipboard text, and the caret after the cut. */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(fakePlugin(settings, doc), event as never);
    return { lines: doc.lines.slice(), clip: event.written["text/plain"], caret: doc.cursor };
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

// Answered (Jason's rulings 2026-10-07: ADR 0003, rule 2, a cut pasted
// back is an undo; built in stage 4 of the result gate design,
// 2026-10-08). A paste of the last cut's text into the note the cut left,
// at the caret it left, writes the note before the cut back exactly, names
// and blank lines included, so the paste back below gives the note back.
// The test was it.fails until then; what it did before is described above.
describe("spec question: cut and paste back a paragraph citing one of two same-text footnotes", () => {
    it("the paste back gives the note back, [^b] and all", () => {
        const ibid = ["First[^a].", "", "Second[^b].", "", "[^a]: Ibid.", "", "[^b]: Ibid."];
        const c = cut(ibid, { line: 2, ch: 0 }, { line: 3, ch: 0 });
        const back = paste(c.lines, c.caret, c.clip);
        // Before the paste back (stage 4, 2026-10-08): the note reads "First[^a].", "", "Second[^a].", "", "[^a]: Ibid.".
        expect(back.lines).toEqual(ibid);
    });
});
