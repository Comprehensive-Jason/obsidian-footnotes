// spec question Q35 (cluster V12): the lint's punctuation rule leaves a
// space before the full stop when the user typed a space before the
// reference. What should it do?
//
// What it does now: with the default settings (After), "Oysters filter
// water [^1]." lints to "Oysters filter water .[^1]", and "A claim [^1],
// and more." to "A claim ,[^1] and more." (live: "water .[1]"). It has done
// this since the rule's first port (6ca151e).
// Options: (a) attach the reference: "water.[^1]" (live: "water.[1]");
// (b) leave a spaced reference where it is: "water [^1]."; (c) keep the
// space before the reference: "water. [^1]". To rule together with D10
// (spec-delete-stray-space-before-punctuation) and G9 (the French space).
// This file asserts no space is left in front of the punctuation.
//
// Hunt 2026-10-09, cycle 8, lenses the lint and the gate (found by both).
// Source: Jason's attach ruling of 2026-09-08 (aa25d9e), which covers the
// space the plugin writes, not one the user typed.
// Origin: pre-existing (red at 34d5377 and 3a47f7a).

import { describe, expect, it } from "vitest";

import { lintFootnotes, LintOptions } from "../../src/linting/linter";

// probe: the default lint (Fix footnote reference placement on,
// placement After) on a reference typed with a space in front of it,
// "a claim [^1]." It moves the reference after the full stop and leaves
// the space where it was, in front of the full stop: "a claim .[^1]". The
// result gate passes it, since it compares the words of a line with its
// references taken out, and "a claim [^1]." already reads "a claim ." that
// way.
const defaults: LintOptions = {
    sectionHeading: "",
    fixPunctuation: true,
    placement: "after",
    fixLazyDefinitions: true,
    moveDefinitionsToBottom: true,
    reindex: true,
    reindexOptions: { renumberNamedFootnotes: false, nameNumberedFootnotes: false },
    removeOrphanedReferences: false,
    removeOrphanedDefinitions: false,
    mergeDuplicateDefinitions: false,
    orphanSafePrefix: "",
    applyNotePrefix: false,
    removeEmptySectionHeading: false,
};
const first = (note: string) => lintFootnotes(note, defaults).split("\n")[0];

describe("the punctuation rule and a space typed before a reference, under After", () => {
    it("control: a reference glued to its word moves after the full stop", () => {
        expect(first("This is a claim[^1].\n\n[^1]: Smith.")).toBe("This is a claim.[^1]");
    });
    it.fails("a reference with a space before it leaves no space before the full stop", () => {
        expect(first("This is a claim [^1].\n\n[^1]: Smith.")).not.toMatch(/claim \./);
    });
    it.fails("nor before a comma", () => {
        expect(first("A claim [^1], and more.\n\n[^1]: Smith.")).not.toMatch(/claim ,/);
    });
    it.fails("nor before the full stop of a sentence that goes on", () => {
        expect(first("This is a claim [^1]. Next one.\n\n[^1]: Smith.")).not.toMatch(/claim \./);
    });
});
