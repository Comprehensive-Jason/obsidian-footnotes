// Imported from the Kimi K3 cycle 1 hunt of 2026-09-16 (OpenCode worktree); rewritten to the fix the same day.
import { describe, expect, it } from "vitest";

import { lintFootnotes, sectionHeadingProblem } from "../../src/linting/linter";

// When the configured section heading's own text held a live reference
// ("# Footnotes [^9]"), the lint never settled: move-to-bottom looked for
// the heading's EXACT text before the renaming rules ran, reindex then
// renumbered the reference inside the heading, the next lint found no
// anchor and appended a fresh copy, and every lint added one more heading
// (Kimi hunt cycle 1: verified growth [^2], [^3], [^4]).
//
// The fix: such a heading can never be an anchor, so the pure lint ignores
// it, and the lint commands cancel with a message that names the
// reference and points at the setting (the same way an invalid prefix
// cancels the lint). Source of truth: the lint idempotence contract
// (the manual lint-rules tests: "run lint AGAIN, it must say No linting
// needed"; the manual lint-stability tests).

const HEADING = "# Footnotes [^9]";

describe("a section heading whose text holds a footnote reference", () => {
    it("is refused as a setting, naming the reference", () => {
        expect(sectionHeadingProblem(HEADING)).toContain('"[^9]"');
        expect(sectionHeadingProblem("# Footnotes")).toBeNull();
        expect(sectionHeadingProblem("---\n## Notes")).toBeNull();
    });

    it("the pure lint ignores it, so the lint settles and no heading is appended", () => {
        const doc = "text[^1]\n\n[^1]: a\n\n[^9]: stray";
        const options = { sectionHeading: HEADING };
        const once = lintFootnotes(doc, options);
        expect(once).not.toContain("# Footnotes");
        expect(lintFootnotes(once, options)).toBe(once);
    });

    it("a note that already carries such a heading settles too: the line is ordinary text now", () => {
        const doc = `text[^1]\n\n${HEADING}\n\n[^1]: a`;
        const options = { sectionHeading: HEADING };
        const once = lintFootnotes(doc, options);
        expect(lintFootnotes(once, options)).toBe(once);
    });

    it("control: a plain heading text is found again and the lint settles (the manual section-heading tests)", () => {
        const doc = "text[^1]\n\n# Footnotes\n\n[^1]: a";
        const options = { sectionHeading: "# Footnotes" };
        const once = lintFootnotes(doc, options);
        expect(once).toBe(doc);
        expect(lintFootnotes(once, options)).toBe(once);
    });
});
