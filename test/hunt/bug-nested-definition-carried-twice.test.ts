import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { carriedDefinitions } from "../../src/commands/carry-footnotes";

// BUG (annoyance): copying text that cites a footnote and a second
// footnote defined inside the first one's definition carries the second
// definition twice.
//
// What the user would see: their note has "[^a]: outer", a blank line,
// and "    [^b]: inner", so [^b] is defined inside [^a]'s definition.
// They copy a sentence that cites both and paste it. The destination
// gets "    [^b]: inner" twice: once inside [^a]'s carried definition,
// and once more on its own. The note now defines [^b] twice, and the
// lint's duplicate alert speaks.
//
// Hunt 2026-10-05, round 1, lens carry. Cluster CA2.
//
// Source of truth: Obsidian's answer probe:e2-blank-sp4label in
// test/obsidian-answers probes.json ("[^1]: def\n\n    [^2]: two"
// defines [^1] over lines 0 to 2 and [^2] inside it on line 2); ruling
// 1, option a, 2026-10-03 (a nested definition counts like any other).
//
// Cause: carriedDefinitions carries each cited footnote's definition
// block whole, and [^a]'s block already holds [^b]'s line, but it then
// carries [^b]'s own block as well, without checking whether that block
// sits inside one it already carries.

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

describe("a definition nested in another carried definition's body travels once", () => {
    const source = ["x[^a] y[^b]", "", "[^a]: outer", "", "    [^b]: inner"];

    it("carriedDefinitions does not carry [^b] a second time", () => {
        const { carried } = carriedDefinitions(source.join("\n"), { line: 0, ch: 0 }, { line: 0, ch: 11 });
        // Today: a: ["[^a]: outer", "", "    [^b]: inner"], and b: ["    [^b]: inner"].
        const lines = carried.flatMap((c) => c.lines);
        expect(lines.filter((l) => l.includes("[^b]:")).length).toBe(1);
    });

    it("the paste lands one [^b] definition, not two", () => {
        const dest = copyAndPaste(source, { line: 0, ch: 0 }, { line: 0, ch: 11 });
        // Today: [..., "[^a]: outer", "", "    [^b]: inner", "    [^b]: inner"].
        expect(dest.filter((l) => l.includes("[^b]:")).length).toBe(1);
    });
});
