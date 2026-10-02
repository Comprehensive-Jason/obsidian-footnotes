import { describe, expect, it } from "vitest";

import { removeEmptySectionHeading } from "../../src/linting/rules/remove-empty-section-heading";

// spec question: should Remove empty section heading keep the note's final
// newline?
//
// What it does now: "text", a blank line, "# Footnotes" and a final
// newline become "text" with no final newline.
// What a user might expect: "text" and a final newline, as every other
// lint rule keeps the newlines the note ended with.
// Why it is a question and not a bug: the rule's docstring says it works
// "so the note ends on its last line of text", which reads as intended.
// Move-to-bottom ("Remember how many blank lines the note ended with;
// they go back on at the end") and merge ("Never hand back more blank
// lines at the end than the note started with") both keep them.
//
// Hunt 2026-10-02, round 2, lens properties. Cluster P9.
//
// Source of truth: the docstrings of remove-empty-section-heading,
// move-to-bottom and merge, quoted above.

describe("spec question: the final newline after removing an empty section heading", () => {
    it.fails("removing an empty section heading keeps the note's final newline", () => {
        expect(removeEmptySectionHeading("text\n\n# Footnotes\n", "# Footnotes")).toBe("text\n");
    });
});
