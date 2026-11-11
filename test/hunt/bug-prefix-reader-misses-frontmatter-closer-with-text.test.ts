import { describe, expect, it } from "vitest";

import { footnotePrefix, footnotePrefixFromEditor } from "../../src/parsing/footnote-prefix";
import { lintFootnotes } from "../../src/linting/linter";
import { fakeEditor } from "../helpers/fake-editor";

// Bug: the footnote prefix reader closed the frontmatter only at a line of
// dashes alone ("---", or "---" with spaces after it). Obsidian closes it
// at the first later line that STARTS with "---" at column 0, and reads
// the rest of that line as ordinary Markdown: "--- # Chapter" closes the
// frontmatter and starts a heading (docs/obsidian-reading-rules.md, D2).
//
// So with "--- # Chapter two" as the closer, a real prefix above it was
// ignored. Worse, the reader walked on into the note's body, and a
// property-shaped line there ("footnote-prefix: wrong-", under a later
// "---") was taken for the prefix: the lint then renamed the note's
// footnotes with a prefix no property holds.
//
// Found by the Kimi K3.1 Pro review (2026-11-11); Jason chose to fix it.

describe("the prefix reader closes the frontmatter where Obsidian does", () => {
    it("reads the prefix when the closing dashes have a heading after them", () => {
        const note = "---\nfootnote-prefix: 2-\n--- # Chapter two\nbody[^1]\n\n[^1]: one";
        expect(footnotePrefix(note)).toBe("2-");
        expect(lintFootnotes(note, { applyNotePrefix: true })).toBe(
            "---\nfootnote-prefix: 2-\n--- # Chapter two\nbody[^2-1]\n\n[^2-1]: one",
        );
    });

    it("does not take a prefix from body text after the real closer", () => {
        const note = ["---", "title: demo", "--- # Chapter", "body[^1]", "", "footnote-prefix: wrong-", "---", "", "[^1]: one"].join("\n");
        expect(footnotePrefix(note)).toBe("");
        expect(lintFootnotes(note, { applyNotePrefix: true })).toBe(note);
    });

    it("the editor reader agrees with the text reader", () => {
        const lines = ["---", "title: demo", "--- # Chapter", "body[^1]", "", "footnote-prefix: wrong-", "---", "", "[^1]: one"];
        expect(footnotePrefixFromEditor(fakeEditor(lines))).toBe("");
        const withPrefix = ["---", "footnote-prefix: 2-", "---x", "body[^1]"];
        expect(footnotePrefixFromEditor(fakeEditor(withPrefix))).toBe("2-");
    });

    // Characterization: the closers that already worked.
    it("a plain closer, and one with spaces after it, still close the frontmatter (as before)", () => {
        expect(footnotePrefix("---\nfootnote-prefix: 2-\n---\nbody")).toBe("2-");
        expect(footnotePrefix("---\nfootnote-prefix: 2-\n---   \nbody")).toBe("2-");
    });
});
