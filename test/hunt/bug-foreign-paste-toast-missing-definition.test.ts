import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (annoyance): a clipboard from another app that cites a footnote it
// carries no definition for does not say so in the paste's toast.
//
// What the user would see: the clipboard, copied from another app, reads
// " a[^9] b[^1]", a blank line, and "[^1]: one". Pasted into a note, the
// plugin lands it and the toast says "Pasted with 1 footnote definition:
// 1 added." with no word about [^9]. A paste of the plugin's own copy says
// '"[^9]" has no definition to carry.' in the same toast. Only the lint's
// general alert after the paste mentions [^9], as a reference to write a
// definition for.
//
// Hunt 2026-10-06, cycle 4, lens carry. Cluster K5.
//
// Origin: pre-existing.
//
// Source of truth: the README's Copy and Paste paragraphs: "The toast
// says how many were added, reused, and renamed, and names any reference
// that travelled without a definition", and "A clipboard that ends in
// definition lines, from anywhere ..., pastes the same way".
//
// Cause: landPastedText in src/commands/carry-footnotes-hooks.ts, on its
// route for a clipboard the plugin did not write (the register does not
// match), sets `missing` to an empty list instead of reading the pasted
// text for the references it cites without carrying a definition, so
// landCarriedText has no names to add to the toast.

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

describe("bug: a foreign clipboard citing a footnote it carries no definition for", () => {
    it("the paste's toast names [^9]", () => {
        const back = paste(["Dest."], { line: 0, ch: 5 }, [" a[^9] b[^1]", "", "[^1]: one"].join("\n"));
        expect(back.taken).toBe(true);
        const toast = messages().find((m) => m.startsWith("Pasted with"));
        // Today the toast reads "Pasted with 1 footnote definition: 1 added."
        expect(toast).toContain("[^9]");
    });
});
