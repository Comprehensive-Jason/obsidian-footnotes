import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (data loss on default settings): pasting text that carries a
// footnote onto an empty last line of a note with no footnotes yet glues
// the pasted text onto the end of the new definition.
//
// What the user would see: the note reads "intro" and then an empty line,
// the usual state after pressing Enter. They paste "a[^1] b" copied with
// its definition "[^1]: one". The note ends up with the definition line
// "[^1]: onea[^1] b": the pasted sentence is inside footnote 1's text, and
// its reference now sits inside its own definition. The same happens with
// two empty lines at the end and the caret on the middle one.
//
// Hunt 2026-10-02, round 2, lens interactions. Cluster I1. Checked against
// the real @codemirror/state as well as the fake editor.
//
// Source of truth: the README's Paste paragraph: paste "lands the text and
// the definitions in one undo, where a new footnote would go". The text
// has to stay text.
//
// Cause: with Remove blank last lines on (the default), the definition
// append trims the trailing empty lines of the note as it read before the
// paste. That trimmed range overlaps the paste point, so the two edits
// land on top of each other.

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

type Pos = { line: number; ch: number };

// The settings around the paste, close to the shipped defaults.
const base = {
    carryFootnotesOnCopy: true,
    enablePopupEditor: false,
    insertAtEndOfWord: false,
    enableFootnotePrefix: false,
    enableFootnoteSectionHeading: false,
    footnoteSectionHeading: "# Footnotes",
    enableRemoveBlankLastLines: true,
    removeEmptySectionHeading: false,
    lintOnFootnoteCreation: false,
};

// Pastes `text` into a fake editor holding `lines`, with the caret at `at`.
function paste(lines: string[], at: Pos, text: string): string[] {
    const doc = fakeEditor(lines, { wholeDoc: true, edits: true, cursor: at, selection: { anchor: at, head: at }, words: true });
    handlePaste(fakePlugin(base, doc), clipboardEvent(text) as never, doc);
    return doc.lines;
}

const text = "a[^1] b\n\n[^1]: one";

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("paste at the end of a note with no definitions yet", () => {
    it("paste on the trailing blank line: the body is not glued to the definition", () => {
        // Today: ["intro", "", "[^1]: onea[^1] b"].
        expect(paste(["intro", ""], { line: 1, ch: 0 }, text)).toEqual(["intro", "a[^1] b", "", "[^1]: one"]);
    });

    it("two trailing blank lines, caret on the middle one: the pasted body is kept, outside the definition", () => {
        const out = paste(["intro", "", ""], { line: 1, ch: 0 }, text);
        expect(out.join("\n")).toContain("a[^1] b");
        expect(out.some((l) => l.startsWith("[^1]: one") && l !== "[^1]: one")).toBe(false);
        expect(out.filter((l) => l.includes("a[^1] b"))).toEqual(["a[^1] b"]);
    });
});
