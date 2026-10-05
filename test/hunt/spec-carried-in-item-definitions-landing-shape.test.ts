import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// spec question: when a paste carries definitions that sat in list items,
// what shape should they land in?
//
// What it does now: the source note holds "- [^1]: one" and "- [^2]: two"
// as two list items. Copying text that cites both and pasting it lands
// "[^1]: one" without its list marker and "- [^2]: two" with it. One
// paste, two shapes.
// What a user might expect: one shape for both, either both unwrapped as
// plain definitions or both kept in list items.
// Why it is a question and not a bug: carry-footnotes.ts leaves it open
// ("how it should land at the destination is open for Jason"), and both
// definitions still work. The answer also decides how to fix the glued
// second definition (bug-carried-second-definition-glued), the indented
// clipboard text (bug-in-item-definition-clipboard-code), and the
// indented definition that is never reused
// (bug-indented-carried-definition-not-reused).
//
// Hunt 2026-10-05, round 1, lens carry. Cluster CA7.
//
// Source of truth: ruling 1, option a, 2026-10-03 (in-item definitions
// are carried, never moved out of their item in the source); the open
// question in carry-footnotes.ts.

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

/** Copy `from`-`to` of `source`, paste at the end of a one-line destination "dest" + blank line; returns the destination's lines. */
function copyAndPaste(source: string[], from: { line: number; ch: number }, to: { line: number; ch: number }): string[] {
    const doc = editor(source, from, to);
    const copy = clipboardEvent();
    handleCopy(fakePlugin(on, doc), copy as never);
    const dest = editor(["dest", ""], { line: 1, ch: 0 });
    handlePaste(fakePlugin(on, dest), clipboardEvent(copy.written["text/plain"]) as never, dest);
    return dest.lines;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("two carried list-item definitions land the same way", () => {
    it.fails("both unwrapped, or both kept in list items", () => {
        const dest = copyAndPaste(["x[^1] y[^2]", "", "- [^1]: one", "- [^2]: two"], { line: 0, ch: 0 }, { line: 0, ch: 11 });
        // Today: [..., "[^1]: one", "- [^2]: two"].
        const one = dest.find((l) => l.includes("[^1]:")) as string;
        const two = dest.find((l) => l.includes("[^2]:")) as string;
        expect(one.startsWith("- ")).toBe(two.startsWith("- "));
    });
});
