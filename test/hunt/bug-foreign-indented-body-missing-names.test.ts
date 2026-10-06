import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (annoyance): a clipboard from another app whose text is indented
// four columns, and which cites a footnote it does not define, gets a
// toast that never names that footnote.
//
// What the user would see: the clipboard reads "    a[^9] b[^1]", a
// blank line, and "[^1]: one". Pasted after "Dest.", the text lands as
// ordinary prose ("Dest.    a[^9] b[^1]"), where [^9] is a reference with
// no definition. The toast says "Pasted with 1 footnote definition: 1
// added." and nothing about [^9], where the same text without the
// indentation gets '"[^9]" has no definition to carry.' in the toast.
//
// Hunt 2026-10-06, cycle 5, lens carry. Cluster X8.
//
// Origin: pre-existing.
//
// Source of truth: the README's Paste paragraph: the toast "names any
// reference that travelled without a definition"; and 5379d63's rule that
// a clipboard from another app gets the same word as the plugin's own copy.
//
// Cause: uncarriedNames in src/commands/carry-footnotes.ts reads the
// clipboard text on its own. There a line indented four columns at the
// start of the text is indented code (a code block: text Obsidian shows
// as written, with no footnotes in it), so it holds no live reference and
// the list of missing names comes back empty, though the text lands as
// prose.

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

/** A line and a character in it. */
type Pos = { line: number; ch: number };

/** Pastes `clip` at `at` in a note holding `lines`; returns the note and whether the plugin took the paste over. */
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

describe("the missing names of a foreign clipboard whose text is indented", () => {
    it.fails("a body indented four columns (code when read alone) still names the reference it cites with no definition", () => {
        // landed after "Dest." the text is prose and [^9] is a live reference with no definition
        const clip = ["    a[^9] b[^1]", "", "[^1]: one"].join("\n");
        const back = paste(["Dest."], { line: 0, ch: 5 }, clip);
        expect(back.taken).toBe(true);
        const toast = messages().find((m) => m.startsWith("Pasted with"));
        // Today: "Pasted with 1 footnote definition: 1 added."
        expect(toast, JSON.stringify({ lines: back.lines, toasts: messages() })).toContain("[^9]");
    });
});
