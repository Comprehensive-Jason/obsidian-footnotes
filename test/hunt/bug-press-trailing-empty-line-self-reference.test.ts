import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { messages, resetNotices } from "../helpers/notices";
import { readNote } from "../../src/parsing/note-reading";

// BUG (wrong output on default settings): a numbered press on the empty
// last line of a note with no footnotes yet writes the new reference
// inside its own definition.
//
// What the user would see: the note reads "Alpha bravo, charlie." and then
// an empty line, the usual state after pressing Enter. They press the
// numbered key on that empty line. The note ends with the line
// "[^1]: [^1]": the reference sits inside the footnote it points at, and
// the prose has no reference at all. The same happens with two empty lines
// at the end and the caret on the middle one, and with a second caret on
// the empty line during a two-caret press.
//
// Hunt 2026-10-02, round 3, lens press. Cluster R1. Checked against the
// real @codemirror/state as well as the fake editor (it writes
// "Alpha bravo, charlie.\n\n[^1]: [^1]"). This is the press twin of round
// 2's paste bug, bug-paste-trailing-blank-glues-body.
//
// Source of truth: ADR 0001 (the plugin never creates a nested footnote).
// A reference belongs in the prose, outside every definition.
//
// Cause: with Remove blank last lines on (the default), the definition
// append trims the note's trailing empty lines, and that trimmed range ends
// at the caret. The reference is written at the caret, so CodeMirror puts
// it after the new label instead of before it.
//
// The assertions do not fix the shape of the repair. Either the reference
// lands outside every definition block, or the press changes nothing and
// says why in a toast.

/** A fake editor holding `lines` with one caret at line, ch. */
function ed(lines: string[], line: number, ch: number): FakeEditor {
    return fakeEditor(lines, { cursor: { line, ch }, edits: true, wholeDoc: true, words: true });
}

/** The plugin on its shipped defaults, with the popup off so the caret stays in the note. */
function pl(doc: FakeEditor) {
    return fakePlugin({ ...DEFAULT_SETTINGS, enablePopupEditor: false }, doc);
}

/** Every line number that sits inside some definition block, its label line included. */
function blockLines(lines: string[]): Set<number> {
    const inside = new Set<number>();
    for (const b of readNote(lines).blocks) {
        for (let i = b.start; i <= b.end; i++) inside.add(i);
    }
    return inside;
}

/** Does some definition block hold a reference or an inline footnote in its text (after its own label)? */
function blockHoldsFootnote(lines: string[]): boolean {
    return readNote(lines).blocks.some((b) =>
        lines.slice(b.start, b.end + 1).some((l, k) => {
            const text = k === 0 ? l.replace(/^\[\^[^\]]+\]:/, "") : l;
            return /\[\^[^\]]+\](?!:)|\^\[/.test(text);
        }),
    );
}

/** Is there a reference on some line outside every definition block? */
function referenceInProse(lines: string[]): boolean {
    const inside = blockLines(lines);
    return lines.some((l, i) => !inside.has(i) && /\[\^[^\]]+\](?!:)/.test(l));
}

/** The repair this pin accepts: the reference went to the prose and no definition holds one, or nothing changed and a toast explained. */
function acceptable(before: string[], after: string[]): boolean {
    if (!blockHoldsFootnote(after) && referenceInProse(after)) return true;
    return after.join("\n") === before.join("\n") && messages().length > 0;
}

beforeEach(resetNotices);

describe("a numbered press on the note's trailing empty line", () => {
    it("keeps the reference out of its own definition", async () => {
        const lines = ["Alpha bravo, charlie.", ""];
        const doc = ed(lines, 1, 0);
        await insertAutonumFootnote(pl(doc));
        // Today: ["Alpha bravo, charlie.", "", "[^1]: [^1]"].
        expect(acceptable(lines, doc.lines)).toBe(true);
    });

    it("on the middle of two trailing empty lines keeps the reference out of its own definition", async () => {
        const lines = ["Alpha", "", ""];
        const doc = ed(lines, 1, 0);
        await insertAutonumFootnote(pl(doc));
        // Today: ["Alpha", "", "[^1]: [^1]"].
        expect(acceptable(lines, doc.lines)).toBe(true);
    });

    it("two carets, one of them on the trailing empty line: no reference ends up inside the definition", async () => {
        const lines = ["Alpha bravo", ""];
        const doc = fakeEditor(lines, {
            carets: [
                { line: 0, ch: 5 },
                { line: 1, ch: 0 },
            ],
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(pl(doc));
        // Today: ["Alpha[^1] bravo", "", "[^1]: [^1]"].
        expect(acceptable(lines, doc.lines)).toBe(true);
    });
});
