import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { carryRegister, handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (data loss in the select-all case): a paste that replaces a
// selection holding the destination's own definitions is planned against
// the note as it was BEFORE the paste, so the pasted footnote can end up
// pointing at a definition the paste itself just deleted.
//
// What the user would see:
// - They press Ctrl+A in a note and paste a copy whose footnote has the
//   same text as the note's own [^1]. The plugin "reuses" that [^1]
//   instead of adding the carried one, but the paste replaced the whole
//   note, [^1]'s definition included, so the pasted reference is left
//   with no definition at all.
// - They select from a reference to the end of the last definition and
//   paste. The new definition lands glued directly under the pasted text,
//   with no blank line, so Obsidian reads it as part of the paragraph and
//   the footnote has no definition.
// - They select from inside a definition to inside the next paragraph and
//   paste. The definition is written into the middle of the replaced
//   range, so the text is spliced into the label ("[^1c[^7]...") and the
//   new definition never appears as a line of its own.
//
// Hunt 2026-10-02, round 1, lenses carry-int and carry-hook. Cluster C12.
//
// Source of truth: the README's Paste paragraph: paste "lands the text and
// the definitions in one undo, where a new footnote would go", and a
// definition the destination "already has" is reused. A definition the
// paste deletes is not one the note has after the paste.
//
// Cause: landCarriedText calls planCarriedPaste(doc.getValue(), ...) and
// buildDefinitionAppend on the note with the selection still in it. The
// plan's reuse and renames, and the append's position and blank-line
// decision, all read text the same transaction removes.

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

const on = { carryFootnotesOnCopy: true };

// An independent reading of a simple note (no code, no comments, no
// quotes), written for the test so it does not share the plugin's code.
// Definitions are column-0 "[^x]: body" lines plus 4-space continuation
// lines; a label directly under a paragraph line is lazy, meaning
// Obsidian reads it as more of that paragraph and not as a definition.
// The LAST definition of a name wins, as in Obsidian, and names match
// without regard to case. Returns every reference in the note and the
// text each one would show (undefined when nothing defines it).
function resolveAll(lines: string[]): { refs: string[]; texts: (string | undefined)[] } {
    const defs = new Map<string, string>();
    const defLine = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
        const m = /^\[\^([^\]]+)\]:\s?(.*)$/.exec(lines[i]);
        if (!m) continue;
        if (i > 0 && lines[i - 1].trim() !== "" && !/^\[\^[^\]]+\]:/.test(lines[i - 1]) && !/^ {4}/.test(lines[i - 1])) continue;
        defLine.add(i);
        const body = [m[2]];
        let j = i + 1;
        while (j < lines.length && /^ {4}/.test(lines[j])) body.push(lines[j++].trim());
        defs.set(m[1].toLowerCase(), body.join(" "));
    }
    const refs: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (defLine.has(i)) continue;
        for (const m of lines[i].matchAll(/\[\^([^\]]+)\]/g)) refs.push(m[1]);
    }
    return { refs, texts: refs.map((r) => defs.get(r.toLowerCase())) };
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("paste over a selection that holds the destination's definitions", () => {
    it.fails("select-all and paste: the reused definition is the one the paste deletes", () => {
        const source = editor(["a[^1] text", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 0, ch: 10 });
        handleCopy(fakePlugin(on, source), clipboardEvent() as never);
        // Ctrl+A in a note whose own [^1] has the same text as the copy's.
        const dest = editor(["x[^1]", "", "[^1]: one"], { line: 0, ch: 0 }, { line: 2, ch: 9 });
        handlePaste(fakePlugin(on, dest), clipboardEvent(carryRegister()?.text ?? "") as never, dest);
        // Today the note is just "a[^1] text": the definition was "reused"
        // and deleted in the same paste.
        expect(resolveAll(dest.lines).texts).toEqual(["one"]);
    });

    it.fails("lands a live definition (not a lazy label glued to the body) when the selection runs to the end of the last definition", () => {
        const dest = editor(["a[^1]", "", "[^1]: one"], { line: 0, ch: 5 }, { line: 2, ch: 9 });
        handlePaste(fakePlugin(on, dest), clipboardEvent("c[^7]\n\n[^7]: seven") as never, dest);
        // The [^7]: label must not sit directly under a paragraph line.
        const label = dest.lines.findIndex((l) => l.startsWith("[^7]:"));
        expect(label).toBeGreaterThan(0);
        expect(dest.lines[label - 1].trim() === "" || /^\[\^[^\]]+\]:/.test(dest.lines[label - 1])).toBe(true);
    });

    it.fails("does not overlap the replaced range with the append when the selection swallows the end of the last definition", () => {
        // The selection runs from inside "[^1]: one" (after "[^1") to
        // inside "tail" (before "il").
        const dest = editor(["a[^1]", "", "[^1]: one", "", "tail"], { line: 2, ch: 3 }, { line: 4, ch: 2 });
        handlePaste(fakePlugin(on, dest), clipboardEvent("c[^7]\n\n[^7]: seven") as never, dest);
        // The unselected "il" stays with the pasted body, and the
        // definition is a line of its own.
        expect(dest.lines).toContain("[^7]: seven");
        expect(dest.lines.some((l) => l.includes("c[^7]il"))).toBe(true);
    });
});
