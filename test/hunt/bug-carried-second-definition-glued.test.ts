import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): copying text that cites two footnotes, when the
// second definition sits in a list item, pastes that second definition
// glued under the first one, where it defines nothing.
//
// What the user would see: their note defines [^1] at the top level and
// [^2] inside a list item, either at the item's margin after a blank
// line ("- item", blank, "    [^2]: two") or in an ordered item not
// numbered 1 ("3. [^2]: two", "2. [^j]: two"). They copy a sentence that
// cites both and paste it. The pasted text reads "[^1]: one" with
// "    [^2]: two" (or "3. [^2]: two") straight under it, with no blank
// line between, so Obsidian reads the second line as more of [^1]'s
// text. [^2] shows as a broken footnote. A paste outside Obsidian gets
// the same text from the clipboard.
//
// Hunt 2026-10-05, round 1, lens carry (and containers). Cluster CA1.
//
// Source of truth: Obsidian's answers in test/obsidian-answers
// probes.json: probe:e2-noblank-sp4label ("[^1]: def\n    [^2]: two"
// defines only [^1]; the indented line is [^1]'s lazy text) and
// probe:b5-def-2. ("[^9]: def\n2. [^1]: def" defines only [^9]; an
// ordered item not starting at 1 cannot interrupt a paragraph). Ruling
// 1, option a, 2026-10-03: in-item definitions are carried.
//
// Cause: the carried blocks are written one under the other with no
// blank line between them. A block that starts at column 0 with "[^2]:"
// interrupts the block above it; one that starts indented 4 columns or
// with an ordered marker other than "1." does not, so it joins the block
// above. How carried in-item definitions should land is the open
// question pinned in spec-carried-in-item-definitions-landing-shape.

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

/** Copy `from`-`to` of `source` and paste the clipboard text into `dest` at `at`; returns the destination editor. */
function copyThenPaste(source: string[], from: { line: number; ch: number }, to: { line: number; ch: number }, dest: string[], at: { line: number; ch: number }) {
    const src = editor(source, from, to);
    const copy = clipboardEvent();
    handleCopy(fakePlugin(on, src), copy as never);
    const doc = editor(dest, at);
    handlePaste(fakePlugin(on, doc), clipboardEvent(copy.written["text/plain"]) as never, doc);
    return doc;
}

/** The names the destination defines, read the way the plugin reads Obsidian. */
function definedNames(lines: string[]): string[] {
    return readNote(lines).definitions.map((d) => d.name);
}

/** What is wrong with `lines`: each live reference with no definition, and each reference that sits inside another footnote's definition. */
function soundness(lines: string[]) {
    const r = readNote(lines);
    const defined = new Set(r.definitions.map((d) => d.name.toLowerCase()));
    const problems: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        for (const ref of r.referencesOn(i)) {
            if (!defined.has(ref.name.toLowerCase())) problems.push(`orphan ${ref.name} on line ${i}`);
            const holder = r.definitionAt(i);
            if (holder && holder.name.toLowerCase() !== ref.name.toLowerCase()) problems.push(`${ref.name} nested in ${holder.name} on line ${i}`);
        }
    }
    return problems;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a second carried definition that sat in a list item lands as a definition", () => {
    it("an in-item definition indented 4 (item paragraph after a blank line)", () => {
        const source = ["x[^1] y[^2]", "", "[^1]: one", "", "- item", "", "    [^2]: two"];
        expect(definedNames(source)).toEqual(["1", "2"]);
        const dest = copyAndPaste(source, { line: 0, ch: 0 }, { line: 0, ch: 11 });
        // Today: ["dest", "x[^1] y[^2]", "", "[^1]: one", "    [^2]: two"], [^2] undefined.
        expect(definedNames(dest)).toContain("2");
    });

    it("an in-item definition in an ordered list that starts at 3", () => {
        const source = ["x[^1] y[^2]", "", "[^1]: one", "", "3. [^2]: two"];
        expect(definedNames(source)).toEqual(["1", "2"]);
        const dest = copyAndPaste(source, { line: 0, ch: 0 }, { line: 0, ch: 11 });
        // Today: ["dest", "x[^1] y[^2]", "", "[^1]: one", "3. [^2]: two"], [^2] undefined.
        expect(definedNames(dest)).toContain("2");
    });

    it("the clipboard text itself (what a paste outside Obsidian gets) keeps [^2] a definition", () => {
        const source = ["x[^1] y[^2]", "", "[^1]: one", "", "- item", "", "    [^2]: two"];
        const doc = editor(source, { line: 0, ch: 0 }, { line: 0, ch: 11 });
        const copy = clipboardEvent();
        handleCopy(fakePlugin(on, doc), copy as never);
        const text = copy.written["text/plain"];
        // Today: "x[^1] y[^2]\n\n[^1]: one\n    [^2]: two".
        expect(definedNames(text.split("\n"))).toEqual(["1", "2"]);
    });

    it("two definitions in an ordered list (2. ...) pasted into a plain note: both still define their footnotes", () => {
        const source = ["a[^i] b[^j] c", "", "1. [^i]: one", "2. [^j]: two"];
        const doc = copyThenPaste(source, { line: 0, ch: 0 }, { line: 0, ch: 13 }, ["Dest text", ""], { line: 1, ch: 0 });
        expect({ lines: doc.lines, problems: soundness(doc.lines) }).toEqual({ lines: doc.lines, problems: [] });
    });

    it("an in-item definition after a top-level one, into a note that has definitions: both still define their footnotes", () => {
        const source = ["a[^t] b[^j] c", "", "[^t]: top", "", "3. [^j]: third item"];
        const doc = copyThenPaste(source, { line: 0, ch: 0 }, { line: 0, ch: 13 }, ["Dest[^d] text", "", "[^d]: dee"], { line: 0, ch: 13 });
        expect({ lines: doc.lines, problems: soundness(doc.lines) }).toEqual({ lines: doc.lines, problems: [] });
    });
});
