// Imported from the GLM 5.3 Flash cycle 5 hunt of 2026-09-16 (OpenCode worktree); 1 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
// RESOLVED 2026-09-16 (GLM hunt cycle 5, probed in Reading view): "%%[^1]: def" renders a footnote, so the glued form is a definition like the spaced one; the commented-definition alert now leaves any label at or after the closer alone.
// GLM 5.3 Flash cycle 9 hunt of 2026-09-16 (this worktree); the red test carries it.fails.
import { describe, expect, it } from "vitest";

import { commentedDefinitionNames } from "../../src/linting/lint-alerts";

import { readNote } from "../../src/parsing/note-reading";

// SPEC QUESTION: is a definition label GLUED to a %% block comment's
// closer ("%%[^1]: def", no space) a definition in Reading view, or is it
// still inside the comment?
//
// The probed ground truth (Jason's verification 2026-09-15, sheet 11 and
// the afterCloser comments) covers the SPACED form: "%% [^3]: def" renders
// as a definition. For the glued form nothing is recorded.
//
// The plugin cannot make up its mind, and the two answers are visible to
// the user at once:
//
// - definitionStartLines accepts it as a REAL definition start (the gap
//   check line.slice(close, label.nameStart - 2).trim() === "" is true for
//   an empty slice), so it gets gathered, renumbered, and its reference
//   binds;
// - commentedDefinitionNames ALSO names it in the "definition inside a %%
//   comment" alert (its guard is nameStart - 2 > close, false for a glued
//   label), telling the user Obsidian never shows it and to move it out.
//
// Both cannot be true: either the label renders (and the alert is noise
// on every lint), or it is dead (and the lint moves/renumbers a footnote
// Obsidian does not render, and may then delete its reference as an
// orphan once the user trusts the alert). Whichever way Reading view
// reads it, one of the two paths must change; until then the alert
// contradicts the rules that act on the same line.
//
// NEEDS A LIVE CHECK: does "%%[^1]: def" (no space after the closer)
// render a footnote entry in Reading view?
//
// Source of truth: the two code paths' own recorded contracts (the
// afterCloser ruling 2026-09-15 vs ADR 2's alert naming); Obsidian
// unprobed for the glued form.
// Settings involved: none (the alert is untied to any toggle).

function startsOf(doc: string): number[] {
    const lines = doc.split("\n");
    return readNote(lines).labelLines
        .map((s, i) => (s ? i : -1))
        .filter((i) => i >= 0);
}

describe("spec: a label glued to a %% block comment's closer", () => {
    it("the definition-start walker and the commented-definition alert agree about it", () => {
        const doc = "%%\nhidden\n%%[^1]: def\ntext[^1] ref";
        // definitionStartLines says the label IS a live definition...
        expect(startsOf(doc)).toEqual([2]);
        // ...so the alert must not name it as hidden inside the comment
        expect(commentedDefinitionNames(doc)).toEqual([]);
    });

    it("control: the SPACED form is consistent (a definition, and never reported)", () => {
        const doc = "%%\nhidden\n%% [^1]: def\ntext[^1] ref";
        expect(startsOf(doc)).toEqual([2]);
        expect(commentedDefinitionNames(doc)).toEqual([]);
    });

    it("control: a label genuinely before the closer is dead and reported", () => {
        const doc = "%%\n[^1]: buried\n%%\ntext[^1] ref";
        expect(startsOf(doc)).toEqual([]);
        expect(commentedDefinitionNames(doc)).toEqual(["1"]);
    });
});
