// Imported from the Kimi K3 cycle 5 hunt of 2026-09-16 (OpenCode worktree); 2 of 3 tests carry it.fails: 0 were red there and marked on import, the rest the hunter marked itself.
import { describe, expect, it } from "vitest";

import { lazyDefinitionLabelNames } from "../../src/linting/rules/remove-orphaned-references";
import { readNote } from "../../src/parsing/note-reading";

// A link reference definition is a block of its own, so a footnote label
// directly under it starts a definition (Kimi hunt cycle 1, verified in
// Reading view 2026-09-16). CommonMark 4.7 lets the LRD's title sit on
// the NEXT line (indented up to three spaces), so the block can run two
// lines: "[foo]: /url" then '  "title"'. The label under THAT is just as
// much after a block (verified with the micromark oracle: the LRD spans
// both lines, and the label parses as a footnoteDefinition).
//
// The plugin's scan ends the LRD block at its first line. blockEnder
// fires on the "[foo]: /url" line, but the title line reads as an
// ordinary indented continuation, so the paragraph state is "open" again
// when the label arrives - and the label is judged lazy prose, one blank
// line short.
//
// What the user sees: Reading view renders their footnote, but the lint
// disagrees: the lazy-definition alert tells them to "add a blank line
// above it" (wrong advice, and against the never-silent policy's spirit
// of only alerting on real problems), or fix-lazy inserts a blank the
// note never needed.
//
// Source of truth: CommonMark 4.7 (the LRD title may follow on the next
// line) + micromark oracle output + the cycle-1 Reading view probe for
// the single-line case.
//
// Settings involved: `Fix definitions hidden by a missing blank line`
// (either state: the fix edits, or the alert speaks, both wrongly).

const doc = "[foo]: /url\n  \"title\"\n[^1]: x";

describe("a footnote label under a two-line link reference definition", () => {
    it("starts a definition, as under the one-line form", () => {
        const lines = doc.split("\n");
        expect(readNote(lines).labelLines).toEqual([false, false, true]);
    });

    it("is not named by the lazy-definition alert", () => {
        const lines = doc.split("\n");
        expect(lazyDefinitionLabelNames(lines)).toEqual([]);
    });

    it("control: under a one-line LRD it starts a definition", () => {
        const lines = ["[foo]: /url", "[^1]: x"];
        expect(readNote(lines).labelLines).toEqual([false, true]);
    });
});
