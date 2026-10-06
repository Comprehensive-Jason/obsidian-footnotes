import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";

// BUG (wrong output): a copy that starts at the end of a definition line
// loses its first line break, so pasting it over itself pulls the next
// paragraph into the footnote.
//
// What the user would see: the note reads "Intro[^a].", a blank line,
// "[^a]: one", "[^d]: two", a blank line, and "Next para.". The user
// selects from the end of "[^a]: one" through "[^d]: two" and the blank
// line after it (a line break, "[^d]: two", a line break), copies, and
// pastes straight back over the same selection. "Next para." now sits
// right under "[^a]: one", where Obsidian reads it as more of [^a]'s text
// (a lazy continuation), so the paragraph vanishes into the footnote, and
// "[^d]: two" moves below it.
//
// Hunt 2026-10-06, cycle 5, lens round trip. Cluster X26.
//
// Origin: pre-existing.
//
// Source of truth: copy then paste over the same selection gives the note
// back; ADR 0001 (no text swallowed into a footnote); and
// docs/obsidian-reading-rules.md E1 (plain text under a definition's text
// continues it).
//
// Cause: remember() in src/commands/carry-footnotes-hooks.ts splits the
// selection with splitCarriedText(selected, true). Read on its own, the
// selection's first line is empty (the rest of "[^a]: one" after the
// caret), and splitCarriedText drops it as the blank line that separates
// a text from its carried definitions. That line is a line break of the
// selection, so the paste joins the line before the selection with the
// line after it.

/** A line and a character in it. */
type Pos = { line: number; ch: number };

/** A stand-in for the browser's clipboard event: it reads `text`, and records what the hook writes and whether the hook took the event over. */
function clip(text = "") {
    const e = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (t: string) => (t === "text/plain" ? text : ""),
            setData: (t: string, v: string) => {
                e.written[t] = v;
            },
        },
        preventDefault() {
            e.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return e;
}

/** A fake editor holding `lines`, with the selection running from `from` to `to` (a bare caret when `to` is left out). */
const ed = (lines: string[], from: Pos, to: Pos = from) =>
    fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });

/** A plugin for `doc` with carrying on and every other setting off. */
const on = (doc: ReturnType<typeof ed>) => fakePlugin({ carryFootnotesOnCopy: true }, doc);

/** The text between `from` and `to` in `ls`. */
function slice(ls: string[], from: Pos, to: Pos): string {
    if (from.line === to.line) return ls[from.line].slice(from.ch, to.ch);
    return [ls[from.line].slice(from.ch), ...ls.slice(from.line + 1, to.line), ls[to.line].slice(0, to.ch)].join("\n");
}

/** Copy from `from` to `to`, then paste the clipboard over the same selection; returns the note (the editor's own paste when the plugin leaves it alone). */
function copyOverItself(note: string[], from: Pos, to: Pos): string[] {
    const source = ed(note, from, to);
    const c = clip();
    handleCopy(on(source), c as never);
    const text = c.defaultPrevented ? c.written["text/plain"] : slice(note, from, to);
    const dest = ed(note, from, to);
    const p = clip(text);
    handlePaste(on(dest), p as never, dest);
    if (p.defaultPrevented) return dest.lines;
    return [...note.slice(0, from.line), ...(note[from.line].slice(0, from.ch) + text + note[to.line].slice(to.ch)).split("\n"), ...note.slice(to.line + 1)];
}

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("a selection starting at the end of a line keeps its leading line break", () => {
    it("copy a line break, '[^d]: two', and a line break from the end of '[^a]: one' and paste it over itself: 'Next para.' stays its own paragraph", () => {
        const note = ["Intro[^a].", "", "[^a]: one", "[^d]: two", "", "Next para."];
        const final = copyOverItself(note, { line: 2, ch: 9 }, { line: 4, ch: 0 });
        // Today: ["Intro[^a].", "", "[^a]: one", "Next para.", "", "[^d]: two"]
        const at = final.indexOf("Next para.");
        expect(final[at - 1]).toBe("");
    });
});
