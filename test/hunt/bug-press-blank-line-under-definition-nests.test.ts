import { beforeEach, describe, expect, it } from "vitest";

import { insertAutonumFootnote, insertInlineFootnote } from "../../src/commands/insert-or-navigate-footnotes";
import { findDefinitionBlocks, scanDocument } from "../../src/parsing/markdown-scan";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { fakeEditor, FakeEditor } from "../helpers/fake-editor";
import { fakePlugin } from "../helpers/fake-plugin";
import { resetNotices } from "../helpers/notices";

// BUG (wrong output on default settings): a press with the caret on the
// empty line right under a definition writes the new reference onto that
// line, where it becomes part of a definition, and the prose under it can
// be pulled into the footnote too.
//
// What the user would see: the note has "[^1]: one", an empty line, and
// "More prose." under it. They put the caret on the empty line and press
// the numbered key. The note now reads "[^1]: one", "[^2]: ", "[^2]",
// "More prose.": the new reference and the prose line are both the text
// of footnote 2, a footnote inside its own footnote. The same happens on
// the empty line between two definitions (the reference joins the first
// one), on the note's last empty line under its definitions, with the
// inline key ("^[]" joins "[^1]: one"), and with one caret of a two-caret
// press on such a line.
//
// Hunt 2026-10-02, round 3, lens press. Cluster R2.
//
// Source of truth: ADR 0001 (the plugin never creates a nested footnote),
// and Reading view: a line directly under a definition, with no blank line
// between, is that definition's lazy continuation (probed 2026-09-16, see
// bug-multi-caret-continuation-nests-in-definition).
//
// Cause: the press guards look at the caret's line as it is, and an empty
// line is not inside any definition. But writing the reference fills that
// empty line, which joins it to the definition above (or to the new label
// the append puts right above it), and the line under it follows.
//
// The assertions do not fix the shape of the repair: after the press, no
// definition block holds a reference or an inline footnote, and no line of
// prose has become part of a definition. A press that refuses with a toast
// passes them too.

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
    for (const b of findDefinitionBlocks(lines, scanDocument(lines))) {
        for (let i = b.start; i <= b.end; i++) inside.add(i);
    }
    return inside;
}

/** Does some definition block hold a reference or an inline footnote in its text (after its own label)? */
function blockHoldsFootnote(lines: string[]): boolean {
    return findDefinitionBlocks(lines, scanDocument(lines)).some((b) =>
        lines.slice(b.start, b.end + 1).some((l, k) => {
            const text = k === 0 ? l.replace(/^\[\^[^\]]+\]:/, "") : l;
            return /\[\^[^\]]+\](?!:)|\^\[/.test(text);
        }),
    );
}

/** Has a line that was prose before the press (not blank, not in a definition) ended up inside a definition block? */
function proseAbsorbed(before: string[], after: string[]): boolean {
    const wasInside = blockLines(before);
    const prose = new Set(before.filter((l, i) => l.trim() !== "" && !wasInside.has(i)));
    const inside = blockLines(after);
    return after.some((l, i) => inside.has(i) && prose.has(l));
}

/** The repair this pin accepts: no definition holds a footnote and no prose line joined one. */
function noNesting(before: string[], after: string[]): boolean {
    return !blockHoldsFootnote(after) && !proseAbsorbed(before, after);
}

beforeEach(resetNotices);

describe("a press on the empty line under a definition", () => {
    it.fails("numbered press on the empty line right under the LAST definition keeps the reference and the prose below out of it", async () => {
        const lines = ["Text[^1] here.", "", "[^1]: one", "", "More prose."];
        const doc = ed(lines, 3, 0);
        await insertAutonumFootnote(pl(doc));
        // Today: "[^1]: one", "[^2]: ", "[^2]", "More prose." - the reference
        // and the prose under it are the new definition's lazy continuation.
        expect(noNesting(lines, doc.lines)).toBe(true);
    });

    it.fails("numbered press on the empty line between two definitions does not nest the reference in the first", async () => {
        const lines = ["Text[^n] and[^1] here.", "", "[^n]: named def", "    continued line", "", "[^1]: one"];
        const doc = ed(lines, 4, 0);
        await insertAutonumFootnote(pl(doc));
        // Today: "[^2]" fills line 4, right under "    continued line", so it
        // is the text of footnote n.
        expect(noNesting(lines, doc.lines)).toBe(true);
    });

    it.fails("inline press on the empty line right under a definition does not nest an inline footnote in it", async () => {
        const lines = ["Text[^1] here.", "", "[^1]: one", "", "More prose."];
        const doc = ed(lines, 3, 0);
        await insertInlineFootnote(pl(doc));
        // Today: "[^1]: one", "^[]", "More prose." - both lines join footnote 1.
        expect(noNesting(lines, doc.lines)).toBe(true);
    });

    it.fails("numbered press on the note's trailing empty line under its definitions keeps the reference out of the new definition", async () => {
        const lines = ["Text[^1] here.", "", "[^1]: one", ""];
        const doc = ed(lines, 3, 0);
        await insertAutonumFootnote(pl(doc));
        // Today: "[^1]: one", "[^2]: ", "[^2]".
        expect(noNesting(lines, doc.lines)).toBe(true);
    });

    it.fails("two carets, one on the empty line under the definitions: that reference stays out of the new definition", async () => {
        const lines = ["Alpha bravo", "", "[^1]: one", ""];
        const doc = fakeEditor(lines, {
            carets: [
                { line: 0, ch: 5 },
                { line: 3, ch: 0 },
            ],
            edits: true,
            wholeDoc: true,
            words: true,
        });
        await insertAutonumFootnote(pl(doc));
        // Today: ["Alpha[^2] bravo", "", "[^1]: one", "[^2]: ", "[^2]"].
        expect(noNesting(lines, doc.lines)).toBe(true);
    });
});
