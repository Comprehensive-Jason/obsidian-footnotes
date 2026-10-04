import { describe, expect, it } from "vitest";

import { readNote } from "../../src/parsing/note-reading";

// BUG: an earlier UNCLOSED inline footnote poisons a later well-formed one.
// The bracket-depth scan counts every unescaped "[" as nesting, so the "[" that
// opens the second, closed "^[closed]" is swallowed as fake nesting for the
// first, unclosed "^[open...". The inner scan finds no matching close and the
// code does an unconditional `if (close === -1) return null;` instead of
// backtracking to the next candidate. Result: the cursor sitting inside a
// perfectly valid closed footnote gets no exit position, and insertInlineFootnote
// then splices a fresh literal "^[]" at the caret, corrupting the good footnote.
// Hunt: 2026-07-17. Lens: offsets. Severity: wrong-output.
//
// Since the runtime swap (steps 2 and 3, 2026-10-03) the note reading says
// which inline footnote holds the caret (NoteReading.inlineNoteAt), so the
// pin asks it; the bracket scan is gone.

describe("bug: unclosed inline footnote strands a later closed one", () => {
    it("a caret inside a later closed ^[...] still finds its exit", () => {
        //            0         1
        //            0123456789012345678
        const line = "a^[open b^[closed] c";
        // "^[closed]" closes at ch 17; a caret at 12 (inside "closed") should
        // exit past the "]" to 18.
        expect(readNote([line]).inlineNoteAt(0, 12)).toEqual({ open: 9, close: 17 });
    });
});
