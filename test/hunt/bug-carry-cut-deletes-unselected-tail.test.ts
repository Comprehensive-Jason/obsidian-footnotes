import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (data loss): a cut that starts inside a definition's continuation
// line and ends just past that footnote's only reference deletes the
// unselected rest of the reference's line.
//
// What the user would see: the note reads "[^a]: def", "    cont xx",
// "", "Para [^a] tail.". They select from the end of "    cont xx" down
// to just after "[^a]" and press Ctrl+X. " tail." was never selected,
// yet afterwards it is in neither the note nor the clipboard. The note is
// left as one empty line.
//
// Hunt 2026-10-02, round 1, lens carry-sel. Cluster C3.
//
// Source of truth: a cut removes the selected text and, per the README,
// "takes the definitions that nothing else in the note uses along with
// the text". Text outside the selection that is not part of such a
// definition must stay in the note.
//
// Cause: deleting the selection joins the unselected tail of its last
// line (" tail.") onto its first line, which is a continuation line of
// [^a]. definitionsOrphanedByCut, reading the note after the deletion,
// sees the joined line as part of [^a]'s block. When it maps the block's
// lines back to the note's own numbering, the joined line is mapped to
// the selection's last line, so handleCut deletes that whole line,
// tail and all.

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

type Pos = { line: number; ch: number };

/** Run the cut hook on a note given as lines, and report the note and the clipboard. */
function cut(lines: string[], from: Pos, to: Pos) {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
    const event = clipboardEvent();
    handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
    // Nothing written means the hook left the cut to the editor.
    return { lines: doc.lines, clipboard: event.written["text/plain"] ?? "" };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("cut from a definition's continuation line to past its only reference", () => {
    it("text after the selection on the to-line is never deleted, even when the join lands it in a definition the cut orphans", () => {
        // The selection runs from the end of [^a]'s continuation line to
        // just after the only [^a] reference; " tail." is not selected.
        const r = cut(["[^a]: def", "    cont xx", "", "Para [^a] tail."], { line: 1, ch: 11 }, { line: 3, ch: 9 });
        // Observed: the note becomes [""] and the clipboard is
        // "\n\nPara [^a]\n\n[^a]: def\n    cont xx", so " tail." is in
        // neither.
        expect(r.lines.join("\n") + r.clipboard).toContain(" tail.");
    });
});
