import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a paste on the empty line right under the last
// definition turns the pasted paragraph into part of the new footnote.
//
// What the user would see: the note ends with "[^1]: one" and an empty
// line. They put the caret on that empty line and paste "b[^n] para" with
// its definition. The new "[^n]: en" is added under "[^1]: one", which is
// the empty line the caret was on, and the pasted paragraph follows it
// directly with no blank line. Obsidian reads the paragraph as a lazy
// continuation of [^n]'s definition (a line that carries on the
// paragraph above it without being indented), so the pasted text vanishes
// into the footnote, and the reference inside it is no longer in the
// note's body.
//
// Hunt 2026-10-02, round 1, lens carry-int. Cluster C13.
//
// Source of truth: the README's Paste paragraph: paste "lands the text and
// the definitions in one undo, where a new footnote would go". The text
// has to stay text.
//
// Cause: buildDefinitionAppend decides whether to add a separating blank
// line by reading the note before the paste, where the line under
// "[^1]: one" is still empty. The paste then fills that line in the same
// transaction.

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

// A fake editor holding `lines`, with the selection running from `from`
// to `to` (the same place when nothing is selected).
function editor(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("paste on the empty line right below the last definition", () => {
    it("the pasted paragraph does not become the new definition's lazy continuation", () => {
        const dest = editor(["x[^1]", "", "[^1]: one", ""], { line: 3, ch: 0 });
        handlePaste(fakePlugin({ carryFootnotesOnCopy: true }, dest), clipboardEvent("b[^n] para\n\n[^n]: en") as never, dest);
        // The pasted body line must not sit directly under a definition
        // line. Today the line above it is "[^n]: en".
        const i = dest.lines.findIndex((l) => l.includes("b[^n] para"));
        expect(i).toBeGreaterThan(0);
        expect(dest.lines[i - 1].trim()).toBe("");
    });
});
