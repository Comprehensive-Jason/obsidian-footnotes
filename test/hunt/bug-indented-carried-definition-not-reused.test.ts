import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (annoyance): a carried definition indented 4 columns or more is
// never matched with the same definition already in the destination, so
// the paste adds a renamed copy.
//
// What the user would see: their source note defines [^1] at a list
// item's margin ("- a", blank, "    [^1]: one") or inside another
// footnote's definition. The destination already defines "[^1]: one".
// They copy the sentence citing [^1] and paste it. Instead of reusing
// the destination's "[^1]: one", the paste renames the footnote to [^2]
// and adds "[^2]: one", a second copy of the same text. The same paste
// from "- [^1]: one" (on the list marker's line) is reused, as the
// control shows.
//
// Hunt 2026-10-05, round 1, lens carry. Cluster CA4.
//
// Source of truth: planCarriedPaste's docstring ("a definition whose
// body, whitespace collapsed, equals an existing definition's is merged
// into it whatever its label"); Obsidian's answer
// pin:bug-list-item-label-margin#1 in test/obsidian-answers pins.json
// ("- item\n\n    [^1]: def" defines [^1]).
//
// Cause: normalisedBody (carry-footnotes.ts) strips the label off a
// carried block before comparing, and finds where the label ends by
// reading the block on its own. Read on its own, "    [^1]: one" is
// indented code (4 or more columns of indentation), so no label is
// found, nothing is stripped, and the key "[^1]: one" never equals the
// destination's "one".

/** A stand-in for the browser's clipboard event, holding `text` to paste and recording what the hook writes. */
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

/** A fake editor holding `lines`, with the selection running from `from` to `to`. */
function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a carried definition indented 4 or more is reused when the destination holds the same text", () => {
    const DEST = ["y[^1]", "", "[^1]: one", ""];

    /** Copies the first 5 characters of `source` and pastes them at the end of DEST; returns the destination's lines. */
    function pasteInto(source: string[]): string[] {
        const doc = editor(source, { line: 0, ch: 0 }, { line: 0, ch: 5 });
        const copy = clipboardEvent();
        handleCopy(fakePlugin(on, doc), copy as never);
        const dest = editor(DEST, { line: 3, ch: 0 });
        handlePaste(fakePlugin(on, dest), clipboardEvent(copy.written["text/plain"]) as never, dest);
        return dest.lines;
    }

    it("control: a definition on the list marker's line is reused", () => {
        expect(pasteInto(["x[^1]", "", "- [^1]: one"]).filter((l) => l.endsWith(": one")).length).toBe(1);
    });

    it.fails("a definition at the list item's margin (4 spaces) is reused, not added as [^2]", () => {
        // Today: ["y[^1]", "", "[^1]: one", "[^2]: one", "", "x[^2]"].
        expect(pasteInto(["x[^1]", "", "- a", "", "    [^1]: one"]).filter((l) => l.endsWith(": one")).length).toBe(1);
    });

    it.fails("a definition nested in another footnote's body is reused, not added as [^2]", () => {
        expect(pasteInto(["x[^1]", "", "[^a]: outer", "", "    [^1]: one"]).filter((l) => l.endsWith(": one")).length).toBe(1);
    });
});
