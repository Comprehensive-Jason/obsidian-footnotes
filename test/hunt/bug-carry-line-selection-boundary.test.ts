import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carriedDefinitions } from "../../src/commands/carry-footnotes";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a selection that only touches a definition's label
// line at its very edge is treated as if it held the whole definition.
// Two shapes do this. A line selection made with Shift+Down stops at
// character 0 (the very start) of the line below, so selecting a
// paragraph and the blank line under it ends at the start of the
// definition's line. And a selection dragged up from the END of the
// definition's line starts on that line without holding any of it.
//
// What the user would see: copy puts the paragraph in the clipboard but
// not its definition, so the footnote arrives in the other note with
// nothing to say. Cut does the same and also leaves the definition
// behind in the source note, where nothing references this footnote any
// more.
//
// Hunt 2026-10-02, round 1, lens carry-sel and carry-reg. Cluster C1.
//
// Source of truth: README, "Copying, cutting, and pasting footnotes":
// "Copy puts the selection and the definitions its footnotes need into
// the clipboard text", and "Cut takes the definitions that nothing else
// in the note uses along with the text". The docstring of
// carriedDefinitions says a block travels with the text when the
// selection contains its first line; here the selection contains none of
// that line's text.
//
// Cause: carriedDefinitions decides a block "travels with the text" by
// comparing only line numbers (block.start between from.line and
// to.line), never the column, so an edge that sits at the start or the
// end of the label line counts as holding it. definitionsOrphanedByCut
// has the same blind spot: the cut joins the label line onto the
// selection's first line, and a block starting on that joined line is
// skipped as one "the selection cut through".

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

/** carriedDefinitions on a note given as lines. */
const carry = (lines: string[], from: { line: number; ch: number }, to: { line: number; ch: number }) =>
    carriedDefinitions(lines.join("\n"), from, to);

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a selection whose edge only touches a definition's label line", () => {
    // The paragraph and the blank line under it, selected with Shift+Down,
    // so the selection ends at character 0 of the definition's line.
    it("a line selection ending at ch 0 of the definition line carries that definition (the selection holds none of its text)", () => {
        expect(carry(["Intro.", "", "Para [^1].", "", "[^1]: one"], { line: 2, ch: 0 }, { line: 4, ch: 0 }).carried).toEqual([
            { name: "1", lines: ["[^1]: one"] },
        ]);
    });

    // The selection starts after the last character of "[^1]: one".
    it("a selection starting at the END of a definition's line carries that definition", () => {
        expect(carry(["[^1]: one", "", "Para [^1]."], { line: 0, ch: 9 }, { line: 2, ch: 10 }).carried).toEqual([
            { name: "1", lines: ["[^1]: one"] },
        ]);
    });

    it("cut takes the definition it orphans along instead of leaving it behind", () => {
        const doc = editor(["Para [^1]", "", "[^1]: def"], { line: 0, ch: 0 }, { line: 2, ch: 0 });
        const event = clipboardEvent();
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
        // Nothing written means the hook left the cut to the editor, whose
        // clipboard holds the bare selection and no definition.
        expect(event.written["text/plain"] ?? "").toContain("[^1]: def");
        expect(doc.lines.join("\n")).not.toContain("[^1]: def");
    });

    // A variant from round 3 (lens carry-model): the selection starts in
    // the middle of the definition's own text, after its label, and runs
    // down to a later reference to that same footnote. The selection holds
    // the reference but not the label, so the definition does not travel
    // with the text and has to be carried. Today nothing is carried and the
    // hook leaves the copy to the editor.
    it("a copy starting mid-body on a definition's label line and ending past a later reference carries that definition", () => {
        const lines = ["x[^a]", "", "[^a]: delta eps", "    gamma", "", "more[^a]"];
        // Today: { carried: [], missing: [] }.
        expect(carry(lines, { line: 2, ch: 8 }, { line: 5, ch: 8 }).carried.map((block) => block.name)).toEqual(["a"]);
    });
});
