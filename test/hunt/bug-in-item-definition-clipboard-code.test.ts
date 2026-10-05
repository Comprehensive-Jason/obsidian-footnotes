import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): a copy that carries a definition from a list item's
// margin writes it to the clipboard as indented code, so every route that
// has only the clipboard text to go on loses the definition.
//
// What the user would see: their note keeps a footnote's definition in a
// list item, at the item's margin after a blank line ("- a", blank,
// "    [^1]: one"). Obsidian reads it as a definition. They copy the
// sentence that cites it. The clipboard text holds "    [^1]: one" after
// a blank line, which on its own is an indented code block (4 or more
// columns of indentation after a blank line), not a definition. Pasted
// outside Obsidian, from the phone keyboard's clipboard history, or in
// another Obsidian window, the reference arrives with no definition and
// the definition as code.
//
// Hunt 2026-10-05, round 1, lens carry. Cluster CA3. Its quoted sibling
// is pinned as bug-carry-quoted-definition-split-round-trip (cluster
// C10, a definition inside a blockquote).
//
// Source of truth: Obsidian's answer pin:bug-list-item-label-margin#1 in
// test/obsidian-answers pins.json ("- item\n\n    [^1]: def" defines
// [^1]); the README, "On a phone, text pasted from the keyboard's
// clipboard history lands the same way"; ruling 1, option a, 2026-10-03
// (in-item definitions are carried).
//
// Cause: carriedDefinitions carries the in-item block with its
// indentation intact, and withCarriedText writes it under the text as it
// is. Out of its list item, the indentation makes it code, so the
// clipboard text no longer defines [^1], and splitCarriedText (the
// reader for the routes with no copy register) finds nothing carried.

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

/** The names the destination defines, read the way the plugin reads Obsidian. */
function definedNames(lines: string[]): string[] {
    return readNote(lines).definitions.map((d) => d.name);
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a carried definition from a list item's margin keeps being a definition in the clipboard text", () => {
    const source = ["x[^1]", "", "- a", "", "    [^1]: one"];

    it.fails("copy of x[^1] whose definition sits at the item's margin writes a clipboard text that defines [^1]", () => {
        expect(definedNames(source)).toEqual(["1"]);
        const doc = editor(source, { line: 0, ch: 0 }, { line: 0, ch: 5 });
        const copy = clipboardEvent();
        handleCopy(fakePlugin(on, doc), copy as never);
        // Today: "x[^1]\n\n    [^1]: one", an indented code block.
        expect(definedNames(copy.written["text/plain"].split("\n"))).toEqual(["1"]);
    });

    it.fails("a paste of that text from another window (no register) still carries [^1]", () => {
        const doc = editor(source, { line: 0, ch: 0 }, { line: 0, ch: 5 });
        const copy = clipboardEvent();
        handleCopy(fakePlugin(on, doc), copy as never);
        // The copy register is how a paste in the same window knows what the
        // copy carried; another window has none.
        resetCarryRegister();
        const dest = editor(["dest", ""], { line: 1, ch: 0 });
        const took = handlePaste(fakePlugin(on, dest), clipboardEvent(copy.written["text/plain"]) as never, dest);
        // Today: false; the editor's own paste lands "    [^1]: one" as code.
        expect(took).toBe(true);
    });
});
