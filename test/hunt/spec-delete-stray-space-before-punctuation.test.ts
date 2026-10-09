import { describe, expect, it } from "vitest";

import { deleteFootnoteEverywhere } from "../../src/commands/delete-footnote";
import { removeOrphanedFootnoteReferences } from "../../src/linting/rules/remove-orphaned-references";

// spec question: when a reference with a space in front of it is cut,
// should the space go too when punctuation follows?
//
// What it does now: "word [^1]." becomes "word .", and "word [^1], more"
// becomes "word , more", with a stray space before the punctuation.
// What a user might expect: "word." and "word, more".
// Why it is a question and not a bug: the cut closes the gap only for a
// space after the reference, so the text around it is left as typed.
// Whether the delete should tidy spacing it did not write is Jason's call.
//
// Answered (Jason's ruling Q35, 2026-10-09, which settles D10 with it):
// the spaces typed between a word and its reference belong to the
// reference, so a cut reference followed by punctuation takes them with
// it: "word [^1]." becomes "word.", and "word [^1], more" becomes "word,
// more". The orphan rule cuts references the same way (cutOne). The test
// below was it.fails until then.
//
// Hunt 2026-10-02, round 2, lens delete. Cluster D10.
//
// Source of truth: none written down; cutOne's own behaviour (it closes
// the gap for a space after the cut).

// Deletes footnote `name` from `lines` and returns the note, or the plan's kind if nothing was deleted.
function md(lines: string[], name: string): string {
    const plan = deleteFootnoteEverywhere(lines.join("\n"), name);
    return plan.kind === "deleted" ? plan.markdown : `<<${plan.kind}>>`;
}

describe("ruling Q35: a space in front of a cut reference", () => {
    it("'word [^1].' leaves no stray space before the full stop", () => {
        expect(md(["word [^1].", "", "[^1]: x"], "1")).toBe("word.");
        expect(md(["word [^1], more", "", "[^1]: x"], "1")).toBe("word, more");
    });
    it("the same in a list item and a quote", () => {
        expect(md(["- word [^1].", "", "[^1]: x"], "1")).toBe("- word.");
        expect(md(["> word [^1]!", "", "[^1]: x"], "1")).toBe("> word!");
    });
    it("control: a reference between words closes the gap as before", () => {
        expect(md(["word [^1] more", "", "[^1]: x"], "1")).toBe("word more");
    });
    it("control: the space after a list marker stays", () => {
        expect(md(["- [^1].", "", "[^1]: x"], "1")).toBe("- .");
    });
    it("the orphan rule cuts the same way", () => {
        expect(removeOrphanedFootnoteReferences("word [^9].\n\nmore[^1]\n\n[^1]: x")).toBe("word.\n\nmore[^1]\n\n[^1]: x");
    });
});
