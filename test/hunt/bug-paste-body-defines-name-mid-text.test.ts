import { beforeEach, describe, expect, it } from "vitest";

import { fakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";
import { handleCopy, handlePaste, resetCarryRegister } from "../../src/commands/carry-footnotes-hooks";
import { readNote } from "../../src/parsing/note-reading";

// BUG (medium, wrong output): a copied text that defines its own
// footnote somewhere other than at its very end lands a second
// definition of a name the destination already uses.
//
// What the user would see: the user copies a whole note with Ctrl+A. The
// note reads "Text[^1].", its definition "[^1]: mine", and a closing line
// under the definition such as "Tags: #a". They paste it into a note that
// has its own [^1]. Nothing is renamed: the note now defines [^1] twice,
// and Obsidian shows only the last definition, so one of the two texts
// is hidden and "Other[^1]" may point at the pasted one. Without the
// closing line (the definition last) the pasted [^1] is renamed, as the
// control below shows.
//
// Jason should confirm the expected behaviour: that a definition in the
// middle of a pasted text, not only one at its end, is renamed when its
// name collides (the reading the README's "come out unique" and the
// planner's docstring give).
//
// Hunt 2026-10-06, cycle 3, lens carry. Cluster K6.
//
// Origin: pre-existing.
//
// Source of truth: the README's Paste paragraph ("the pasted footnotes
// come out unique with no setup"); the pin
// bug-carry-selection-own-definition-duplicates (a whole note copied and
// pasted into a note that uses the same name must not leave two
// definitions of it); planCarriedPaste's docstring, which says the one
// planner sees "the names the pasted body defines itself".
//
// Cause: the copy needs nothing from outside the selection, so the
// editor's own copy writes the plain text. On the paste, splitCarriedText
// in src/commands/carry-footnotes.ts only lifts a trailing run of
// definition lines, and this text ends in "Tags: #a", so nothing is
// carried. landPastedText in src/commands/carry-footnotes-hooks.ts then
// gives the paste back to the editor without asking the planner, which
// would have renamed the body's own [^1].

type Pos = { line: number; ch: number };

/** A stand-in for the browser's clipboard event: it reads `text` and records what the plugin writes back. */
function clip(text = "") {
    const event = {
        written: {} as Record<string, string>,
        defaultPrevented: false,
        clipboardData: {
            types: ["text/plain"],
            getData: (t: string) => (t === "text/plain" ? text : ""),
            setData: (t: string, v: string) => {
                event.written[t] = v;
            },
        },
        preventDefault() {
            event.defaultPrevented = true;
        },
        stopPropagation() {},
    };
    return event;
}

/** A fake editor holding `lines`, with the selection running from `from` to `to` (the same place when nothing is selected). */
function ed(lines: string[], from: Pos, to: Pos = from) {
    return fakeEditor(lines, { wholeDoc: true, edits: true, cursor: from, selection: { anchor: from, head: to } });
}
const on = { carryFootnotesOnCopy: true };

/** How many definitions of `name` the plugin's reader finds in `lines`. */
const defsOf = (lines: string[], name: string) => readNote(lines).definitions.filter((d) => d.name.toLowerCase() === name).length;

beforeEach(() => {
    resetNotices();
    resetCarryRegister();
});

describe("bug: a pasted text's own definition in the middle of it", () => {
    it("a whole note copied with Ctrl+A, its definition followed by a closing line, pasted into a note using the same name, leaves one definition per name", () => {
        const source = ["Text[^1].", "", "[^1]: mine", "", "Tags: #a"];
        const src = ed(source, { line: 0, ch: 0 }, { line: 4, ch: 8 });
        const ev = clip();
        handleCopy(fakePlugin(on, src), ev as never);
        // when the plugin leaves the copy to the editor, the editor's own copy holds the plain text
        const text = ev.written["text/plain"] ?? source.join("\n");
        const dest = ed(["Other[^1].", "", "[^1]: theirs"], { line: 0, ch: 10 });
        // a paste the plugin leaves alone is the editor's own: the text goes in as it is
        if (!handlePaste(fakePlugin(on, dest), clip(text) as never, dest)) dest.transaction({ changes: [{ from: { line: 0, ch: 10 }, text }] });
        // Today the note holds two definitions of [^1].
        expect(defsOf(dest.lines, "1")).toBe(1);
    });

    it("control: the same note with its definition last is renamed (the pin's case)", () => {
        const source = ["Text[^1].", "", "[^1]: mine"];
        const src = ed(source, { line: 0, ch: 0 }, { line: 2, ch: 10 });
        const ev = clip();
        handleCopy(fakePlugin(on, src), ev as never);
        const text = ev.written["text/plain"] ?? source.join("\n");
        const dest = ed(["Other[^1].", "", "[^1]: theirs"], { line: 0, ch: 10 });
        if (!handlePaste(fakePlugin(on, dest), clip(text) as never, dest)) dest.transaction({ changes: [{ from: { line: 0, ch: 10 }, text }] });
        expect(defsOf(dest.lines, "1")).toBe(1);
    });
});
