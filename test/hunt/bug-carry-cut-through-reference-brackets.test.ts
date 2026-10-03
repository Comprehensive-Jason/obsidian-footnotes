import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCut, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (data loss): a cut whose selection ends inside a reference's
// brackets deletes that footnote's definition from the note without
// putting it in the clipboard.
//
// What the user would see: in "a[^1] b" they select "a[^" (the selection
// stops between "[^" and "1]") and press Ctrl+X. The note keeps "1] b",
// the clipboard holds "a[^", and the definition "[^1]: precious text" is
// gone from both. A toast even says to "paste to carry it along", but
// there is nothing to paste. Undo brings it back; nothing else does.
//
// Hunt 2026-10-02, round 1, lens carry-hook. Cluster C2.
//
// Source of truth: README, "Copying, cutting, and pasting footnotes":
// "Cut takes the definitions that nothing else in the note uses along
// with the text". A definition the cut removes from the note must reach
// the clipboard, or it is lost.
//
// Cause: the two halves of the cut disagree about a reference the
// selection cuts through (only part of its brackets selected).
// carriedDefinitions skips it on purpose, so the clipboard carries no
// definition. definitionsOrphanedByCut looks at the note after the
// deletion, where "1] b" is no reference at all, so it lists [^1] as
// orphaned (nothing references this footnote any more) and handleCut
// deletes the definition.

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

describe("cut through a reference's brackets", () => {
    it("never removes a definition from the note that the clipboard does not carry", () => {
        const doc = editor(["a[^1] b", "", "[^1]: precious text"], { line: 0, ch: 0 }, { line: 0, ch: 3 });
        const event = clipboardEvent();
        handleCut(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
        // Nothing written means the hook left the cut to the editor, whose
        // clipboard holds the bare selection "a[^".
        const clipboard = event.written["text/plain"] ?? "a[^";
        const everywhere = doc.lines.join("\n") + "\n" + clipboard;
        expect(everywhere).toContain("precious text");
    });
});
