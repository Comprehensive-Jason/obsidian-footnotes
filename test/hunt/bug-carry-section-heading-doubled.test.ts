import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): pasting a whole note, section heading included, into
// an empty note gives it the footnote section heading twice.
//
// What the user would see: they use a footnote section heading
// ("# Footnotes"). They copy a whole note from another app, or from
// another vault, and paste it into a new empty note. The result has
// "# Footnotes" twice in a row, the copied one and a new one the plugin
// added, with the definition under the second.
//
// Hunt 2026-10-02, round 1, lens carry-clip. Cluster C28.
//
// Source of truth: the README's Paste paragraph: paste lands the
// definitions "where a new footnote would go". The settings add the
// section heading only for a note's first footnote, so a heading that is
// already there should be used, not repeated.
//
// Cause: the fallback splits the trailing definition off the clipboard
// and leaves "# Footnotes" at the end of the pasted body. The append is
// then built against the empty destination, which has no heading and no
// footnotes, so it adds the heading again under the body.

// A stand-in for the browser's clipboard event: it reads `text` and
// records what the plugin writes back.
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

// A fake editor holding `lines`, with the selection running from `from`
// to `to` (the same place when nothing is selected).
function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

const on = { carryFootnotesOnCopy: true };

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a whole note with its section heading, pasted into an empty note", () => {
    it.fails("2d: a whole note pasted into an empty one does not get a second section heading", () => {
        const doc = editor([""], { line: 0, ch: 0 });
        const plugin = fakePlugin({ ...on, enableFootnoteSectionHeading: true, footnoteSectionHeading: "# Footnotes" }, doc);
        handlePaste(plugin, clipboardEvent("text[^1]\n\n# Footnotes\n\n[^1]: one") as never, doc);
        // Today: "text[^1]", "", "# Footnotes", "# Footnotes", "", "[^1]: one".
        expect(doc.lines.filter((l) => l === "# Footnotes")).toHaveLength(1);
    });
});
