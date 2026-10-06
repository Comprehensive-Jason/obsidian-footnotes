import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output): a held definition carried inside its outer block
// keeps its name when the note it is pasted into already uses that name.
//
// What the user would see: the copied text "x[^a] y[^b]" cites [^a], and
// [^b] is defined inside [^a]'s definition, indented under it (a "held"
// definition). The note it is pasted into already has its own "[^b]:
// other", cited by "z[^b]". After the paste the note holds two
// definitions named b. Obsidian shows the last copy of a name, so the
// destination's own "z" now shows the pasted "inner" text instead of
// "other". A carried definition that is not held is renamed when its name
// is taken, so this one alone collides.
//
// Hunt 2026-10-05, round 2, lens carry. Cluster C6.
//
// Source of truth: Obsidian 1.14.4, asked live on 2026-10-05: a copy held
// inside another definition counts when Obsidian picks the last copy of a
// name. The carry's own rule: a carried footnote whose name the
// destination uses for another body is renamed (planCarriedPaste).
//
// Cause: the carry takes the outermost blocks only, so the held [^b]
// travels as lines inside [^a]'s block. planCarriedPaste in
// src/commands/carry-footnotes.ts checks and renames the carried blocks'
// own names, not the names of definitions held inside them.

/** A stand-in for the browser's clipboard event: what was written, and whether the editor's own action was stopped. */
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

function editor(lines: string[], from: { line: number; ch: number }, to = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}

/** Copy from..to of source with the carry on, then paste the clipboard text into dest at `at`. */
function copyThenPaste(settings: object, source: string[], from: { line: number; ch: number }, to: { line: number; ch: number }, dest: string[], at: { line: number; ch: number }) {
    const s = { carryFootnotesOnCopy: true, ...settings };
    const src = editor(source, from, to);
    const copy = clipboardEvent();
    handleCopy(fakePlugin(s, src), copy as never);
    const doc = editor(dest, at);
    handlePaste(fakePlugin(s, doc), clipboardEvent(copy.written["text/plain"]) as never, doc);
    return { doc, clip: copy.written["text/plain"] };
}

/** Each footnote name and the text it shows (the last definition of a name wins). */
function shown(lines: string[]): Map<string, string> {
    const r = readNote(lines);
    const out = new Map<string, string>();
    for (const d of r.definitions) {
        const body = lines
            .slice(d.start, d.end + 1)
            .map((l, i) => (i === 0 ? l.slice(d.labelEnd) : l))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        out.set(d.name.toLowerCase(), body);
    }
    return out;
}

/** For each live reference on lines from..to, the text it shows. */
function citedTexts(lines: string[], from: number, to: number): (string | undefined)[] {
    const r = readNote(lines);
    const s = shown(lines);
    const out: (string | undefined)[] = [];
    for (let i = from; i <= to; i++) for (const o of r.referencesOn(i)) out.push(s.get(o.name.toLowerCase()));
    return out;
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a held definition pasted into a note that uses its name", () => {
    it("the pasted y cites 'inner' and the destination's z still cites 'other'", () => {
        const source = ["x[^a] y[^b]", "", "[^a]: outer", "", "    [^b]: inner"];
        const dest = ["z[^b]", "", "[^b]: other", "", ""];
        const { doc } = copyThenPaste({}, source, { line: 0, ch: 0 }, { line: 0, ch: 11 }, dest, { line: 4, ch: 0 });
        const lines = doc.lines;
        // Today z shows "inner": the pasted held [^b] is the last copy of b.
        expect(citedTexts(lines, 0, 0)).toEqual(["other"]);
        const pastedLine = lines.findIndex((l) => l.startsWith("x["));
        expect(citedTexts(lines, pastedLine, pastedLine)).toEqual([expect.stringContaining("outer"), "inner"]);
    });
});
