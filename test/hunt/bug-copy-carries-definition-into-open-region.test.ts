import { beforeEach, describe, expect, it } from "vitest";

import { handleCopy, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { splitCarriedText } from "../../src/commands/carry-footnotes";
import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// Bug: a copy whose selection ends on the line that opens a code fence (or
// a "%%" comment, a "$$" math block, an HTML comment) wrote the carried
// definitions after that opener in the clipboard. The block never closes
// inside the clipboard text, so there the definitions are code or comment
// text: pasted into another window, another vault, or from a phone
// keyboard's clipboard history, the footnote arrived as code. A cut of the
// same shape is already refused.
//
// The note:
//     Para[^a].
//     ```
//     code
//     ```
//
//     [^a]: alpha
// Selection: from the start of "Para[^a]." to just after the three
// backticks; "Carry footnotes when copying" on; Ctrl+C.
//
// Now: when the carried definitions would not read as definitions in the
// clipboard text, the copy is the editor's own, the selected text alone
// (Jason's ruling, 2026-11-11), as a paste into protected text already is.
//
// Found by the DeepSeek V4.1 Flash review (2026-11-11).

function clipboardEvent() {
    const event = {
        written: {} as Partial<Record<string, string>>,
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

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

/** Copies the note from its start to `to`, and returns what the copy wrote, if anything. */
function copy(note: string[], to: { line: number; ch: number }) {
    const doc = fakeEditor(note, { wholeDoc: true, cursor: to, selection: { anchor: { line: 0, ch: 0 }, head: to } });
    const event = clipboardEvent();
    handleCopy(fakePlugin({ carryFootnotesOnCopy: true }, doc), event as never);
    return { took: event.defaultPrevented, text: event.written["text/plain"] };
}

describe("a copy that ends on the line that opens a block", () => {
    const opened: [string, string[], { line: number; ch: number }][] = [
        ["a code fence", ["Para[^a].", "```", "code", "```", "", "[^a]: alpha"], { line: 1, ch: 3 }],
        ["a %% comment", ["Para[^a].", "%%", "hidden", "%%", "", "[^a]: alpha"], { line: 1, ch: 2 }],
        ["a math block", ["Para[^a].", "$$", "m", "$$", "", "[^a]: alpha"], { line: 1, ch: 2 }],
        ["an HTML comment", ["Para[^a].", "<!--", "hidden -->", "", "[^a]: alpha"], { line: 1, ch: 4 }],
    ];
    for (const [what, note, to] of opened) {
        it(`${what}: the copy is the editor's own, not a clipboard text with the definition inside the block`, () => {
            const { took } = copy(note, to);
            expect(took).toBe(false);
        });
    }

    // Characterization: a copy that ends in ordinary text carries the
    // definition, and the clipboard text reads it back.
    it("ending in a paragraph, the copy carries the definition (as before)", () => {
        const { took, text } = copy(["Para[^a].", "", "[^a]: alpha"], { line: 0, ch: 9 });
        expect(took).toBe(true);
        expect(splitCarriedText(text ?? "").carried.map((block) => block.name)).toEqual(["a"]);
    });
});
