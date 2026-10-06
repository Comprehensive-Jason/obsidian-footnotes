import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineDiffChanges } from "../../src/editor/document-diff";
import { lintFootnotes } from "../../src/linting/linter";

// BUG (annoyance): when the lint renumbers two references on the same
// line, a caret between them jumps back into the first one.
//
// What the user would see: "A[^1] Bravo[^2] end." with both footnotes
// defined. The user types " new" after "A[^1]" and presses the numbered
// key, which writes "[^3]" there, then saves. The lint renumbers "[^3]" to
// "[^2]" and "[^2]" to "[^3]". The caret, which sat right after the
// reference just pressed, now sits inside it ("new[^|2]"). A caret in the
// word between the two references jumps there too. This is common: a
// press early in a paragraph, then Ctrl+S.
//
// Hunt 2026-10-06, cycle 5, lens diff. Cluster X20.
//
// Origin: pre-existing.
//
// Source of truth: manual sheet 12, "Lint triggers and settings page"
// ("the caret is still where it was"); lineDiffChanges's own comment (only
// the differing characters are rewritten, so a caret after the changed
// characters on a changed line keeps its column).
//
// Cause: lineDiffChanges in src/editor/document-diff.ts writes a changed
// line as one edit, and trimCommonEdges trims only the characters the old
// and new line share at the edit's two ends. With two renumbered
// references on the line, the edit still runs from the first changed digit
// to the last, over "3] Bravo[^2", and the editor puts a caret inside a
// replaced span at that span's start. Splitting the line into one edit per
// changed reference would leave the caret where it was.

/**
 * Where the editor puts a caret at (line, ch) of `before` once the lint's
 * edits are applied. CodeMirror carries the caret through the edits with
 * "assoc -1" (a caret where text is replaced goes to the start of the new
 * text), as it does when the plugin's Editor.transaction carries no
 * selection.
 */
function mapCaret(before: string, after: string, line: number, ch: number) {
    const changes = lineDiffChanges(before, after);
    const a = before.split("\n");
    let off = ch;
    for (let i = 0; i < line; i++) off += a[i].length + 1;
    const set = ChangeSet.of(changes.map((c) => ({ from: c.from, to: c.to, insert: c.text })), before.length);
    const mapped = set.mapPos(off, -1);
    const b = after.split("\n");
    let l = 0;
    let rest = mapped;
    while (l < b.length - 1 && rest > b[l].length) {
        rest -= b[l].length + 1;
        l++;
    }
    return { line: l, ch: rest };
}

/** The lines joined into one note. */
const L = (...lines: string[]) => lines.join("\n");

describe("a caret between two references the lint renumbers on one line", () => {
    const before = L("A[^1] new[^3] Bravo[^2] end.", "", "[^1]: one", "[^2]: two", "[^3]: three");

    it("control: the default lint renumbers both references on the line", () => {
        expect(lintFootnotes(before, {}).split("\n")[0]).toBe("A[^1] new[^2] Bravo[^3] end.");
    });

    // Now: the caret goes to column 11, inside the reference just pressed.
    it.fails("a caret right after the reference just pressed stays after it", () => {
        const after = lintFootnotes(before, {});
        expect(mapCaret(before, after, 0, "A[^1] new[^3]".length)).toEqual({ line: 0, ch: "A[^1] new[^2]".length });
    });

    // Now: the caret goes to column 11, inside the first reference
    // ("new[^|2]").
    it.fails("a caret inside the word between the two stays inside that word", () => {
        const after = lintFootnotes(before, {});
        expect(mapCaret(before, after, 0, "A[^1] new[^3] Bra".length)).toEqual({ line: 0, ch: "A[^1] new[^2] Bra".length });
    });
});
